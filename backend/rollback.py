"""
Cascading rollback for Super Admin (24-hour window).

Strategy: the audit chain already stores `before` and `after` for every create /
update / delete. For a rollback, we:
  1. Find every subsequent audit entry on the same record within the window.
  2. Reverse them in LIFO order to restore state.
  3. Reverse linked side-effects:
       - stock_ledger rows written with ref == entity+id
       - cost_postings on projects.budget.<head>.actual
       - vouchers created by the hook

The rollback is itself audited ("rollback" action) so the chain stays complete.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from core import audit, col, current_user, db, now, uid

router = APIRouter(prefix="/api")

WINDOW_HOURS = 24


def _within_window(iso_str: str) -> bool:
    try:
        ts = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except Exception:
        return False
    return datetime.now(timezone.utc) - ts <= timedelta(hours=WINDOW_HOURS)


def _require_super(user):
    if not user.get("is_super"):
        raise HTTPException(403, "Only Super Admin may use rollback")


@router.get("/admin/rollback/recent")
async def list_recent(limit: int = 100, user=Depends(current_user)):
    """Recent reversible audit entries within the 24-hour window."""
    _require_super(user)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)).isoformat()
    items = (
        await db.audit.find(
            {"action": {"$in": ["create", "update", "delete", "approve"]}, "at": {"$gte": cutoff}},
            {"_id": 0},
        )
        .sort("seq", -1)
        .to_list(limit)
    )
    return items


async def _preview_entries(cid, entity, entity_id, since_seq):
    """Audit entries on a single record since the chosen seq (inclusive)."""
    return await db.audit.find(
        {"company_id": cid, "entity": entity, "entity_id": entity_id, "seq": {"$gte": since_seq}},
        {"_id": 0},
    ).sort("seq", 1).to_list(500)


async def _linked_side_effects(cid, entity, entity_id):
    """Side-effects we know how to reverse."""
    ref = f"{entity}:{entity_id}"
    stock = await col(cid, "stock_ledger").find({"ref": ref}, {"_id": 0}).to_list(500)
    costs = await col(cid, "cost_postings").find({"ref": ref}, {"_id": 0}).to_list(500)
    vouchers = await col(cid, "vouchers").find({"ref_entity": entity, "ref_id": entity_id}, {"_id": 0}).to_list(500)
    alerts = await col(cid, "alerts").find({"entity": entity, "entity_id": entity_id}, {"_id": 0}).to_list(50)
    return {"stock_ledger": stock, "cost_postings": costs, "vouchers": vouchers, "alerts": alerts}


@router.get("/admin/rollback/preview/{seq}")
async def preview(seq: int, user=Depends(current_user)):
    """Preview what will be reversed if this audit entry is rolled back."""
    _require_super(user)
    entry = await db.audit.find_one({"seq": seq}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Audit entry not found")
    if not _within_window(entry["at"]):
        raise HTTPException(409, "Outside 24-hour rollback window")

    cid, entity, eid = entry["company_id"], entry["entity"], entry["entity_id"]
    entries = await _preview_entries(cid, entity, eid, seq)
    effects = await _linked_side_effects(cid, entity, eid)
    return {
        "entry": entry,
        "chain": entries,
        "linked": {
            "stock_ledger_rows": len(effects["stock_ledger"]),
            "cost_postings_rows": len(effects["cost_postings"]),
            "vouchers_rows": len(effects["vouchers"]),
            "alerts_rows": len(effects["alerts"]),
        },
        "summary": _summarise(entries, effects),
    }


def _summarise(entries, effects):
    lines = []
    for e in entries:
        lines.append(f"{e['action'].upper()} {e['entity']} by {e.get('user_name','?')} at {e['at'][:19]}")
    if effects["stock_ledger"]:
        lines.append(f"Reverse {len(effects['stock_ledger'])} stock-ledger entries")
    if effects["cost_postings"]:
        amt = sum(float(x.get("amount") or 0) for x in effects["cost_postings"])
        lines.append(f"Reverse ₹{amt:,.0f} of budget actuals ({len(effects['cost_postings'])} postings)")
    if effects["vouchers"]:
        lines.append(f"Remove {len(effects['vouchers'])} unposted vouchers")
    if effects["alerts"]:
        lines.append(f"Dismiss {len(effects['alerts'])} alerts")
    return lines


@router.post("/admin/rollback/execute/{seq}")
async def execute(seq: int, body: dict = Body(default={}), user=Depends(current_user)):
    """Reverse an audit entry and all of its subsequent state + side-effects."""
    _require_super(user)
    entry = await db.audit.find_one({"seq": seq}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Audit entry not found")
    if not _within_window(entry["at"]):
        raise HTTPException(409, "Outside 24-hour rollback window")

    reason = (body or {}).get("reason") or "Super Admin cascading rollback"
    cid, entity, eid = entry["company_id"], entry["entity"], entry["entity_id"]

    # 1) Determine the "goal" state = the `before` of the earliest entry in the chain
    chain = await _preview_entries(cid, entity, eid, seq)
    if not chain:
        raise HTTPException(409, "Nothing to reverse")
    goal_before = chain[0].get("changes") and chain[0].get("action")  # noqa: placeholder
    first = chain[0]

    c = col(cid, entity)
    cur_doc = await c.find_one({"id": eid}, {"_id": 0})

    reversed_actions = []

    if first["action"] == "create":
        # Reverse: delete the record entirely
        if cur_doc:
            await c.delete_one({"id": eid})
            reversed_actions.append("Deleted record (originally created)")
    else:
        # Reconstruct the before-state by applying `changes.old` in reverse order.
        restored = dict(cur_doc or {})
        for e in reversed(chain):
            changes = e.get("changes") or {}
            for field, pair in changes.items():
                restored[field] = pair.get("old")
        # Drop meta keys we don't want to overwrite
        restored.pop("_id", None)
        if restored:
            await c.replace_one({"id": eid}, restored, upsert=True)
            reversed_actions.append("Restored prior state")

    # 2) Reverse linked side-effects
    effects = await _linked_side_effects(cid, entity, eid)

    # 2a) Stock ledger: insert compensating entries then mark originals reversed
    for s in effects["stock_ledger"]:
        if s.get("reversed"):
            continue
        comp = dict(s)
        comp.update(
            id=uid(),
            qty=-float(s.get("qty") or 0),
            note=f"Rollback of {s.get('id')}",
            ref=f"rollback:{entity}:{eid}",
            at=now(),
            reversed=False,
            created_by=user.get("name", "System"),
        )
        comp.pop("_id", None)
        await col(cid, "stock_ledger").insert_one(comp)
        await col(cid, "stock_ledger").update_one({"id": s["id"]}, {"$set": {"reversed": True}})
    if effects["stock_ledger"]:
        reversed_actions.append(f"Reversed {len(effects['stock_ledger'])} stock rows")

    # 2b) Cost postings: subtract amount from projects.budget.<head>.actual and
    # delete the posting
    for cp in effects["cost_postings"]:
        pid, head, amt = cp.get("project_id"), cp.get("head"), float(cp.get("amount") or 0)
        if pid and head and amt:
            proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0, "budget": 1})
            if proj:
                budget = proj.get("budget") or {}
                if head in budget:
                    budget[head]["actual"] = round(float(budget[head].get("actual") or 0) - amt, 2)
                    await col(cid, "projects").update_one({"id": pid}, {"$set": {"budget": budget}})
        await col(cid, "cost_postings").delete_one({"id": cp["id"]})
    if effects["cost_postings"]:
        reversed_actions.append(f"Reversed {len(effects['cost_postings'])} budget postings")

    # 2c) Unposted vouchers — delete; posted ones must stay (handled manually)
    pending_vouchers = [v for v in effects["vouchers"] if v.get("status") != "Posted"]
    for v in pending_vouchers:
        await col(cid, "vouchers").delete_one({"id": v["id"]})
    if pending_vouchers:
        reversed_actions.append(f"Removed {len(pending_vouchers)} pending vouchers")

    # 2d) Alerts
    for a in effects["alerts"]:
        await col(cid, "alerts").delete_one({"id": a["id"]})
    if effects["alerts"]:
        reversed_actions.append(f"Dismissed {len(effects['alerts'])} alerts")

    # 3) Audit the rollback itself (chained hash preserved)
    await audit(cid, user, "rollback", entity, eid, before=cur_doc, after=None,
                note=f"Rollback of seq#{seq} ({entry['action']}) — reason: {reason}")

    return {"ok": True, "reversed": reversed_actions, "entry_seq": seq, "reason": reason}
