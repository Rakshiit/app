import os, uuid, json, hashlib, logging, re, ipaddress
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
import bcrypt, jwt, httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Header, Query, Depends, Request
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
logger = logging.getLogger("erp")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me")
APP_URL = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
SESSION_HOURS = 12


def uid():
    return uuid.uuid4().hex[:12]


def now():
    return datetime.now(timezone.utc).isoformat()


def today():
    return date.today().isoformat()


def fy_code(d: str | None = None):
    dt = date.fromisoformat(d[:10]) if d else date.today()
    y = dt.year if dt.month >= 4 else dt.year - 1
    return f"{str(y)[2:]}{str(y + 1)[2:]}"


def num(v, default=0.0):
    try:
        if v in (None, ""):
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def col(cid: str, name: str):
    """Physically separate collection per company."""
    return db[f"co_{cid}_{name}"]


def clean(doc):
    if isinstance(doc, list):
        return [clean(d) for d in doc]
    if isinstance(doc, dict):
        return {k: clean(v) for k, v in doc.items() if k != "_id"}
    if isinstance(doc, datetime):
        return doc.isoformat()
    return doc


# ---------------- auth ----------------
def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def check_pw(p, h):
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def make_token(user_id):
    exp = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm="HS256")


LEVELS = {"none": 0, "view": 1, "edit": 2, "approve": 3, "admin": 4}


async def build_ctx(user):
    roles = await db.roles.find({"id": {"$in": user.get("roles", [])}}, {"_id": 0}).to_list(100)
    modules, masked, hidden_tabs, names = {}, set(), set(), []
    is_super = user.get("is_super", False)
    for r in roles:
        names.append(r["name"])
        if r["name"] == "Super Admin":
            is_super = True
        for m, lv in (r.get("modules") or {}).items():
            if LEVELS.get(lv, 0) > LEVELS.get(modules.get(m, "none"), 0):
                modules[m] = lv
        masked |= set(r.get("masked_fields") or [])
        hidden_tabs |= set(r.get("hidden_tabs") or [])
    # fields masked only if ALL roles mask them
    if roles:
        masked = set.intersection(*[set(r.get("masked_fields") or []) for r in roles])
    if is_super:
        masked, hidden_tabs = set(), set()
    # delegations: acting roles from delegators
    acting = set(names)
    td = today()
    delegators = await db.users.find({"delegations": {"$elemMatch": {"to_user_id": user["id"], "from_date": {"$lte": td}, "to_date": {"$gte": td}}}}, {"_id": 0, "roles": 1}).to_list(50)
    for d in delegators:
        rs = await db.roles.find({"id": {"$in": d.get("roles", [])}}, {"_id": 0, "name": 1}).to_list(50)
        acting |= {r["name"] for r in rs}
    u = {k: v for k, v in user.items() if k not in ("password_hash",)}
    u.update({"role_names": names, "acting_roles": sorted(acting), "modules": modules, "masked_fields": sorted(masked),
              "hidden_tabs": sorted(hidden_tabs), "is_super": is_super})
    return u


async def current_user(authorization: str = Header(None), token: str = Query(None)):
    raw = None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:]
    elif token:
        raw = token
    if not raw:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(raw, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired, please log in again")
    except Exception:
        raise HTTPException(401, "Invalid session")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or user.get("locked"):
        raise HTTPException(401, "Account locked or not found")
    return await build_ctx(user)


def has_company(user, cid):
    return user["is_super"] or "*" in user.get("company_ids", []) or cid in user.get("company_ids", [])


def require(user, cid, module, level="view"):
    if not has_company(user, cid):
        raise HTTPException(403, "No access to this company")
    if user["is_super"]:
        return
    if LEVELS.get(user["modules"].get(module, "none"), 0) < LEVELS[level]:
        raise HTTPException(403, f"Your role does not have {level} access to {module}")


def mask(doc, fields):
    if not fields:
        return doc
    if isinstance(doc, list):
        return [mask(d, fields) for d in doc]
    if isinstance(doc, dict):
        return {k: ("••••" if k in fields and v not in (None, "") else mask(v, fields)) for k, v in doc.items()}
    return doc


# ---------------- audit (hash chained) ----------------
async def audit(cid, user, action, entity, entity_id, before=None, after=None, note=""):
    last = await db.audit.find_one({}, sort=[("seq", -1)])
    seq = (last["seq"] + 1) if last else 1
    prev = last["hash"] if last else "GENESIS"
    changes = {}
    if isinstance(before, dict) and isinstance(after, dict):
        for k in set(before) | set(after):
            if k in ("updated_at", "_id"):
                continue
            if before.get(k) != after.get(k):
                changes[k] = {"old": before.get(k), "new": after.get(k)}
    entry = {"seq": seq, "id": uid(), "company_id": cid, "user_id": (user or {}).get("id", "system"),
             "user_name": (user or {}).get("name", "System"), "action": action, "entity": entity,
             "entity_id": entity_id, "changes": changes, "note": note, "at": now(), "prev_hash": prev}
    entry["hash"] = hashlib.sha256((prev + json.dumps(entry, sort_keys=True, default=str)).encode()).hexdigest()
    await db.audit.insert_one(entry)


async def verify_audit_chain():
    prev, n = "GENESIS", 0
    async for e in db.audit.find({}, {"_id": 0}).sort("seq", 1):
        h = e.pop("hash")
        if e["prev_hash"] != prev or hashlib.sha256((prev + json.dumps(e, sort_keys=True, default=str)).encode()).hexdigest() != h:
            return {"valid": False, "broken_at": e["seq"], "checked": n}
        prev, n = h, n + 1
    return {"valid": True, "checked": n}


# ---------------- numbering ----------------
async def next_number(cid, doc_type, state=None, d=None, prefix=None):
    comp = await db.companies.find_one({"id": cid}, {"_id": 0, "short_code": 1, "default_state": 1})
    short = (comp or {}).get("short_code", "CO")
    st = (state or (comp or {}).get("default_state") or "XX")[:2].upper()
    fy = fy_code(d)
    key = f"{cid}:{doc_type}:{st}:{fy}"
    r = await db.counters.find_one_and_update({"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"{short}-{st}-{fy}-{prefix or doc_type.upper()}{r['seq']:03d}"


# ---------------- files (Emergent object storage, per-company prefix) ----------------
import asyncio
import mimetypes
import requests

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "jkee-erp"
_storage_key = None


def init_storage(force=False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put(path, data, ctype):
    for attempt in range(2):
        r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(attempt > 0), "Content-Type": ctype}, data=data, timeout=120)
        if r.status_code == 404 and attempt == 0:
            continue
        r.raise_for_status()
        return r.json()


def _get(path):
    for attempt in range(2):
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(attempt > 0)}, timeout=60)
        if r.status_code == 404 and attempt == 0:
            continue
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def save_file(cid, filename, data: bytes, user=None, meta=None, content_type=None):
    fid = uid()
    ext = (filename or "file.bin").rsplit(".", 1)[-1].lower() if "." in (filename or "") else "bin"
    ctype = content_type or mimetypes.guess_type(filename or "")[0] or "application/octet-stream"
    res = await asyncio.to_thread(_put, f"{APP_NAME}/{cid}/{fid}.{ext}", data, ctype)
    rec = {"id": fid, "name": filename, "storage_path": res["path"], "content_type": ctype, "size": len(data),
           "uploaded_by": (user or {}).get("name"), "at": now(), "is_deleted": False, **(meta or {})}
    await col(cid, "files").insert_one(dict(rec))
    return {k: v for k, v in rec.items() if k != "storage_path"}


async def read_file(cid, fid):
    rec = await col(cid, "files").find_one({"id": fid, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File not found")
    data, _ = await asyncio.to_thread(_get, rec["storage_path"])
    return rec, data


# ---------------- email (Emergent managed) ----------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host):
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown, real):
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject, html):
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} differs from link host {real!r} (G3)")


async def send_email(cid, *, to, subject, html, entity=None, entity_id=None, vendor_id=None, user=None):
    """Sends via Emergent managed email; always logs status. Never raises — returns log record."""
    comp = await db.companies.find_one({"id": cid}, {"_id": 0, "name": 1, "reply_to": 1}) or {}
    from_name = comp.get("name") or os.environ.get("EMAIL_FROM_NAME", "JK Electric Engineers")
    rec = {"id": uid(), "to": to, "subject": subject, "html": html, "entity": entity, "entity_id": entity_id,
           "vendor_id": vendor_id, "sent_by": (user or {}).get("name", "System"), "at": now(), "status": "Queued",
           "direction": "Outbound", "attached_to": []}
    try:
        _assert_safe_email(subject, html)
        payload = {"to": [to], "subject": subject, "html": html, "from_name": from_name}
        if comp.get("reply_to"):
            payload["contact_email"] = comp["reply_to"]
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, json=payload)
        if r.status_code in (200, 201, 202):
            rec.update(status="Sent", provider_id=r.json().get("id"))
        else:
            try:
                j = r.json()
            except Exception:
                j = {}
            rec.update(status="Failed", error=f"{r.status_code} {j.get('code', '')}: {j.get('message', r.text[:200])}")
            logger.warning("Email failed: %s", rec["error"])
    except Exception as e:
        rec.update(status="Failed", error=str(e)[:300])
    await col(cid, "email_log").insert_one(dict(rec))
    return clean(rec)


def email_shell(company, title, body_html):
    pc = (company.get("theme") or {}).get("primary", "#20309A")
    return (f'<table role="presentation" width="100%" style="font-family:Arial,sans-serif;background:#f6f7f9"><tr><td style="padding:20px">'
            f'<table role="presentation" width="100%" style="max-width:680px;margin:auto;background:#ffffff;border:1px solid #e3e7ef">'
            f'<tr><td style="background:{pc};color:#ffffff;padding:14px 20px;font-size:16px;font-weight:bold">{escape(company.get("name", ""))}</td></tr>'
            f'<tr><td style="padding:20px;font-size:14px;color:#0b1220"><h3 style="margin-top:0">{escape(title)}</h3>{body_html}</td></tr>'
            f'<tr><td style="padding:12px 20px;font-size:11px;color:#667085;border-top:1px solid #e3e7ef">Sent by {escape(company.get("name", ""))} via JKEE EPC ERP. '
            f'We never ask for passwords or payment details by email.</td></tr></table></td></tr></table>')
