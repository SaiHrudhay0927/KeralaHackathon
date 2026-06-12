# Evidence Platform — Backend

Node.js + Express + MongoDB (mongoose). All sample data is **synthetic** (demo case).

## Setup

```powershell
cd evidence-platform\backend
npm install
copy .env.example .env   # then fill in MONGO_URI and OPENAI_API_KEY
npm start
```

Graceful fallbacks (for dev/demo without secrets):

- No `MONGO_URI` → in-memory MongoDB via `mongodb-memory-server` (data lost on restart).
- No `OPENAI_API_KEY` → deterministic rule-based extraction (regex + keyword heuristics).
  Every audit entry records which engine (`openai` vs `fallback-rules`) produced a result.

## Pipeline

Upload → sha256 (chain of custody) → parse → extract entities/flags → resolve into
graph (`same_owner` edges, never silent merges) → score leads. Everything is audited;
nothing is deleted (low scores go to the second-look queue).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | server + DB status |
| POST | `/api/evidence/upload` | multipart `file` (+ optional `sourceType`) — runs full pipeline |
| GET | `/api/evidence` | list evidence files |
| GET | `/api/evidence/:id/events` | events parsed from one file |
| GET | `/api/graph` | `{ nodes, edges }` for the network view |
| GET | `/api/leads?status=` | ranked leads (`active`, `second_look`, `reviewed`) |
| PATCH | `/api/leads/:id/review` | investigator review (audited) |
| POST | `/api/leads/rescore` | re-evaluate all leads incl. second-look queue |
| GET | `/api/audit` | audit log (latest 500) |

## Quick test

```powershell
# from evidence-platform\backend, with the server running:
node scripts\upload-evidence.js ..\..\whatsapp_chat_ananya.txt ..\..\call_records.csv ..\..\instagram_dms.json
Invoke-RestMethod http://localhost:5000/api/graph | ConvertTo-Json -Depth 5
```
