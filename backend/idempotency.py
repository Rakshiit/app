"""
Idempotency middleware for offline sync support.

Clients (mobile outbox) may include header `Idempotency-Key: <uuid>` on mutation
requests. If the same (user, method, path, key) is retried, the previously stored
response is returned verbatim — preventing duplicate records from network retries.

Only POST/PUT/PATCH/DELETE on /api/* are considered. Key presence is opt-in —
callers without the header bypass the middleware entirely.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from core import db

MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
STORE_TTL_SECONDS = 24 * 60 * 60  # keep idempotency cache 24h
LOCK_WAIT_SECONDS = 25  # when a matching request is already in-flight


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        key = request.headers.get("idempotency-key") or request.headers.get("Idempotency-Key")
        if not key or request.method not in MUTATION_METHODS or not request.url.path.startswith("/api"):
            return await call_next(request)

        # Identify requester (same user with same key should be de-duped)
        auth = request.headers.get("authorization", "")
        actor = auth.split()[-1][-24:] if auth else "anon"
        cache_id = f"{actor}:{request.method}:{request.url.path}:{key}"

        # Fast path: completed response cached
        existing = await db.idempotency_keys.find_one({"_id": cache_id})
        if existing and existing.get("status") == "done":
            return _rebuild_response(existing)

        # In-flight → wait briefly for original to complete
        if existing and existing.get("status") == "in_flight":
            deadline = time.time() + LOCK_WAIT_SECONDS
            while time.time() < deadline:
                existing = await db.idempotency_keys.find_one({"_id": cache_id})
                if existing and existing.get("status") == "done":
                    return _rebuild_response(existing)
                await asyncio.sleep(0.25)
            return JSONResponse(
                {"detail": "Duplicate request in flight. Retry shortly."},
                status_code=409,
            )

        # Claim the slot
        now = datetime.now(timezone.utc)
        try:
            await db.idempotency_keys.insert_one(
                {
                    "_id": cache_id,
                    "status": "in_flight",
                    "created_at": now,
                    "expires_at": now + timedelta(seconds=STORE_TTL_SECONDS),
                    "method": request.method,
                    "path": request.url.path,
                }
            )
        except Exception:
            # Another worker just claimed → fall back to wait loop above
            existing = await db.idempotency_keys.find_one({"_id": cache_id})
            if existing and existing.get("status") == "done":
                return _rebuild_response(existing)
            return JSONResponse(
                {"detail": "Duplicate request in flight. Retry shortly."},
                status_code=409,
            )

        # Execute downstream and capture response body
        response: Response = await call_next(request)

        body_chunks = []
        async for chunk in response.body_iterator:
            body_chunks.append(chunk)
        body = b"".join(body_chunks)

        # Persist only successful mutations — failures should not be cached
        # (so the client can retry after fixing the underlying issue).
        if 200 <= response.status_code < 300:
            await db.idempotency_keys.update_one(
                {"_id": cache_id},
                {
                    "$set": {
                        "status": "done",
                        "completed_at": datetime.now(timezone.utc),
                        "status_code": response.status_code,
                        "body": body.decode("utf-8", errors="replace"),
                        "content_type": response.media_type or response.headers.get("content-type", "application/json"),
                    }
                },
            )
        else:
            # release the slot so the client may retry
            await db.idempotency_keys.delete_one({"_id": cache_id})

        return Response(
            content=body,
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() != "content-length"},
            media_type=response.media_type,
        )


def _rebuild_response(doc: dict) -> Response:
    body = doc.get("body", "")
    content_type = doc.get("content_type") or "application/json"
    return Response(
        content=body.encode("utf-8") if isinstance(body, str) else body,
        status_code=doc.get("status_code", 200),
        media_type=content_type,
        headers={"X-Idempotent-Replay": "1"},
    )


async def ensure_idempotency_indexes():
    """TTL index on expires_at (BSON date) so old keys self-expire."""
    try:
        await db.idempotency_keys.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass

