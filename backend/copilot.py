"""
AI Co-Pilot — plain-language queries over company data.

How it works (permission-safe by design):
  1. The LLM is prompted to translate the user's natural-language question
     into a **structured query plan** (JSON): `{register, filters, order_by,
     limit, aggregate, columns}` — never SQL and never raw DB access.
  2. The backend validates the plan against the user's module permissions
     (`require(user, cid, module, "view")`) and applies field masking from
     `user["masked_fields"]` before returning any rows.
  3. The LLM then receives only the permitted, masked rows and writes a
     concise natural-language answer with citations (register + record ids).

This two-step pattern prevents prompt-injection from exfiltrating masked or
out-of-scope data because the data layer sees only our validated plan.

Supported providers (via EMERGENT_LLM_KEY):
  - Gemini 2.5 Flash  (default; fastest, free-tier friendly)
  - Claude Sonnet 4.5
  - ChatGPT 5 (gpt-5)
Perplexity requires a user-supplied key — if not set, we return a friendly
message pointing the admin to configure it.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core import col, current_user, mask, require, uid
from registers import R as REGISTERS

router = APIRouter(prefix="/api")

PROVIDERS = {
    "gemini": ("gemini", "gemini-2.5-flash"),
    "claude": ("anthropic", "claude-sonnet-4-5-20250929"),
    "chatgpt": ("openai", "gpt-5"),
    "perplexity": ("perplexity", "llama-3.1-sonar-large-128k-online"),
}

ALLOWED_REGISTERS = list(REGISTERS.keys())


def _require_llm_key():
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(503, "Emergent LLM key not configured on server")
    return key


SYSTEM_PROMPT = """You are an ERP query planner for an Indian EPC (Electrical & Civil) contracting company called JKEE.

Your job is to convert a user's plain-English question into a STRICT JSON query plan. You NEVER write SQL, Python, or free-form code — only the JSON plan below.

Output ONLY a JSON object (no markdown fencing, no commentary) matching:
{
  "register": "<one of the allowed register names>",
  "filters": { "<field>": <value> | {"$gte":..}|{"$lte":..}|{"$in":[..]} },
  "order_by": "<field>",
  "order_dir": "asc" | "desc",
  "limit": <int, 1-200>,
  "columns": ["field1", "field2", ...]   // keep this short, 4-6 columns max
}

Allowed registers (choose exactly one): {registers}

Rules:
- Pick the SMALLEST set of fields in "columns" that answers the question.
- Use "status" filters where the user asks for "pending", "approved", etc.
- For date windows (today / this week / this month), use ISO date strings in filters.
- If the user asks something unanswerable from a single register, pick the best primary register.
- Never invent register names.
- Always include "limit" (default 50)."""


ANSWER_PROMPT = """You are an ERP assistant. The user asked:
"{question}"

You executed the plan and received these rows (already permission-filtered and masked where required):
{rows_json}

Write a concise answer in 1-4 short paragraphs or a compact markdown list. Cite row ids in square brackets like [id:abc123]. If a value shows `••••`, it is masked for this user — do NOT invent a number, just note that it's restricted."""


def _validate_plan(plan: dict, user: dict, cid: str) -> dict:
    if not isinstance(plan, dict):
        raise HTTPException(400, "Plan not a JSON object")
    reg = plan.get("register")
    if reg not in REGISTERS:
        raise HTTPException(400, f"Unknown register '{reg}'")
    module = REGISTERS[reg][0]
    # Enforce module-level permission
    require(user, cid, module, "view")
    filters = plan.get("filters") or {}
    if not isinstance(filters, dict):
        filters = {}
    # Strip unsafe operators (only allow simple keys + $gte/$lte/$in/$ne)
    SAFE_OPS = {"$gte", "$lte", "$gt", "$lt", "$in", "$ne", "$regex"}
    cleaned = {}
    for k, v in filters.items():
        if not isinstance(k, str) or k.startswith("$") or "." in k:
            continue
        if isinstance(v, dict):
            v = {op: val for op, val in v.items() if op in SAFE_OPS}
            if not v:
                continue
        cleaned[k] = v
    plan["filters"] = cleaned
    try:
        plan["limit"] = max(1, min(200, int(plan.get("limit", 50))))
    except Exception:
        plan["limit"] = 50
    plan["order_dir"] = -1 if (plan.get("order_dir") or "desc").lower().startswith("d") else 1
    plan["columns"] = [c for c in (plan.get("columns") or []) if isinstance(c, str)][:12]
    return plan


async def _execute(plan: dict, user: dict, cid: str) -> list:
    reg = plan["register"]
    # Reuse scoping from list_records-equivalent
    from registers import scope_filter
    f = scope_filter(user, reg)
    f.update(plan["filters"] or {})
    # Return the full document (minus _id) so masking can act on all sensitive
    # fields. The LLM-suggested `columns` are kept only as a presentation hint.
    sort_key = plan.get("order_by") or "created_at"
    rows = await col(cid, reg).find(f, {"_id": 0}).sort(sort_key, plan["order_dir"]).to_list(plan["limit"])
    return mask(rows, user.get("masked_fields") or [])


def _extract_json(text: str) -> Optional[dict]:
    # Strip fencing if present
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


async def _call_llm(provider_key: str, system: str, prompt: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    if provider_key not in PROVIDERS:
        provider_key = "gemini"
    prov, model = PROVIDERS[provider_key]

    if prov == "perplexity":
        api_key = os.environ.get("PERPLEXITY_API_KEY")
        if not api_key:
            raise HTTPException(
                400,
                "Perplexity requires its own API key. Ask your administrator to configure PERPLEXITY_API_KEY, or choose another model.",
            )
        # Minimal direct call (emergentintegrations covers OpenAI/Anthropic/Gemini)
        import httpx
        url = "https://api.perplexity.ai/chat/completions"
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(url, headers={"Authorization": f"Bearer {api_key}"},
                             json={"model": model,
                                   "messages": [{"role": "system", "content": system},
                                                {"role": "user", "content": prompt}]})
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    key = _require_llm_key()
    chat = LlmChat(api_key=key, session_id=f"copilot-{uid()}", system_message=system).with_model(prov, model)
    return await chat.send_message(UserMessage(text=prompt))


@router.get("/c/{cid}/copilot/models")
async def models(cid: str, user=Depends(current_user)):
    """Expose which models are usable given server-side keys."""
    available = []
    for k in ("gemini", "claude", "chatgpt"):
        available.append({"key": k, "label": {"gemini": "Gemini 2.5 Flash",
                                                "claude": "Claude Sonnet 4.5",
                                                "chatgpt": "ChatGPT 5"}[k], "ready": True})
    available.append({"key": "perplexity", "label": "Perplexity Sonar",
                      "ready": bool(os.environ.get("PERPLEXITY_API_KEY"))})
    return available


@router.post("/c/{cid}/copilot/query")
async def query(cid: str, body: dict = Body(...), user=Depends(current_user)):
    question = (body.get("prompt") or "").strip()
    provider = (body.get("model") or "gemini").lower()
    if not question:
        raise HTTPException(400, "prompt is required")
    if len(question) > 2000:
        raise HTTPException(400, "Prompt too long")

    # -- Step 1: ask the LLM for a plan --
    sys_msg = SYSTEM_PROMPT.replace("{registers}", ", ".join(ALLOWED_REGISTERS))
    user_mods = user.get("modules") or {}
    # Hint which modules the user can actually see
    allowed = [r for r in ALLOWED_REGISTERS if user_mods.get(REGISTERS[r][0]) not in (None, "none")]
    plan_prompt = f"Available registers for this user (prefer these): {', '.join(allowed) or 'none'}\n\nUser question: {question}"
    raw_plan = await _call_llm(provider, sys_msg, plan_prompt)
    plan = _extract_json(raw_plan)
    if not plan:
        return {"error": "Could not understand the question", "raw": raw_plan[:400]}

    try:
        plan = _validate_plan(plan, user, cid)
        rows = await _execute(plan, user, cid)
    except HTTPException as e:
        return {"error": e.detail, "plan": plan}

    # -- Step 2: ask the LLM to summarise the rows --
    answer = await _call_llm(
        provider,
        "You are a concise ERP assistant. Never guess masked values. Always cite row ids.",
        ANSWER_PROMPT.format(question=question, rows_json=json.dumps(rows[:50], default=str)[:8000]),
    )
    citations = [{"id": r.get("id"), "number": r.get("number") or r.get("code") or r.get("name"), "register": plan["register"]}
                 for r in rows if r.get("id")][:20]
    return {
        "answer": answer,
        "plan": plan,
        "rows": rows,
        "citations": citations,
        "model": provider,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
