import asyncio, os, json, uuid, httpx
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType, TextDelta, StreamDone
from reportlab.pdfgen import canvas

PDF = "/tmp/nit_test.pdf"

def make_pdf():
    c = canvas.Canvas(PDF)
    y = 800
    for line in ["NOTICE INVITING TENDER No. JKPDD/EM/2026/045", "Name of Work: Construction of 33/11kV Substation at Ganderbal",
                 "Estimated Cost: Rs 4,85,00,000", "EMD: Rs 9,70,000", "Bid Submission End Date: 25-03-2026 15:00",
                 "Pre-bid meeting: 10-03-2026", "Eligibility: Class A electrical contractor, turnover 15 Cr avg 3 years",
                 "Documents: GST certificate, PAN, Electrical licence, ISO 9001"]:
        c.drawString(50, y, line); y -= 20
    c.save()

async def test_ai():
    make_pdf()
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=str(uuid.uuid4()),
                   system_message="Extract tender fields. Reply ONLY JSON.").with_model("gemini", "gemini-2.5-flash")
    msg = UserMessage(text='Return JSON {"fields":[{"key","label","value","confidence"(0-1)}]} for tender_no, title, estimated_value(number), emd(number), bid_due_date(YYYY-MM-DD), eligibility, required_documents.',
                      file_contents=[FileContentWithMimeType(file_path=PDF, mime_type="application/pdf")])
    out = ""
    async for ev in chat.stream_message(msg):
        if isinstance(ev, TextDelta): out += ev.content
        elif isinstance(ev, StreamDone): break
    s = out[out.find("{"): out.rfind("}") + 1]
    data = json.loads(s)
    print("AI OK:", json.dumps(data)[:600])
    assert len(data["fields"]) >= 5

async def test_email():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post("https://integrations.emergentagent.com/api/v1/email/send",
                         headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]},
                         json={"to": ["delivered@resend.dev"], "subject": "JKEE ERP POC", "html": "<p>RFQ test from JK Electric Engineers</p>",
                               "from_name": os.environ["EMAIL_FROM_NAME"]})
        print("EMAIL:", r.status_code, r.text[:200])
        assert r.status_code in (200, 202)

async def main():
    await test_ai(); await test_email(); print("ALL CORE PASSED")
asyncio.run(main())
