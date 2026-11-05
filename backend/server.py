import asyncio
import logging
import os
from contextlib import suppress
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from core import client, db, init_storage
import registers
import flows_a
import flows_b
import seed
import rollback
import mailbox
import templates_studio
import copilot
import pretender
from idempotency import IdempotencyMiddleware, ensure_idempotency_indexes

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="JKEE EPC ERP")
app.include_router(flows_a.router)
app.include_router(flows_b.router)
app.include_router(registers.router)
app.include_router(rollback.router)
app.include_router(mailbox.router)
app.include_router(templates_studio.router)
app.include_router(copilot.router)
app.include_router(pretender.router)
# NOTE: middleware runs for every request; keep CORS added LAST so it wraps the
# idempotency layer (Starlette runs the outermost middleware first).
app.add_middleware(IdempotencyMiddleware)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])


@app.get("/api/")
async def root():
    return {"message": "JKEE EPC ERP API"}


@app.get("/api/sync/ping")
async def sync_ping():
    """Lightweight reachability probe used by the offline queue."""
    from datetime import datetime, timezone
    return {"ok": True, "server_time": datetime.now(timezone.utc).isoformat()}


async def ensure_indexes():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.audit.create_index("seq")
        await db.approvals.create_index([("company_id", 1), ("status", 1)])
        await db.vendor_links.create_index("token", unique=True)
        await db.counters.create_index("key", unique=True)
        await db.doc_verifications.create_index("code")
        for c in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(100):
            for name in ("tenders", "projects", "wbs", "dprs", "stock_ledger", "attendance", "vouchers", "ra_bills", "employees", "pos", "files"):
                await db[f"co_{c['id']}_{name}"].create_index("id")
                if name not in ("tenders", "employees", "files"):
                    await db[f"co_{c['id']}_{name}"].create_index("project_id")
    except Exception as e:
        logger.error("index build: %s", e)


@app.on_event("startup")
async def startup():
    try:
        await asyncio.to_thread(init_storage)
    except Exception as e:
        logger.error("Storage init failed: %s", e)
    try:
        await seed.seed()
    except Exception as e:
        logger.exception("Seed failed: %s", e)
    try:
        await ensure_idempotency_indexes()
    except Exception as e:
        logger.error("Idempotency index build: %s", e)
    app.state.idx = asyncio.create_task(ensure_indexes())


@app.on_event("shutdown")
async def shutdown():
    app.state.idx.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.idx
    client.close()
