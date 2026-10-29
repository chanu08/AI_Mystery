# AI Mystery Room — Product & Technical Specification

> **Status:** Single source of truth. If code and this document disagree, this document wins. If this document is silent or ambiguous, choose the simplest option consistent with it and record the decision in `DECISIONS.md`.
> **Version:** 1.0 · **Date:** 2026-10-28

---

## 1. Overview

**AI Mystery Room** is a web app where a user submits a short scenario or story seed (e.g. "A jewelry went missing at a family wedding"). The backend uses Gemini to invent a fictional investigation with a hidden culprit, then produces a set of evidence items (WhatsApp-style chats, images, CCTV-style footage, and more). The user studies the evidence, picks a culprit, and gets a verdict with an explanation and score.

### 1.1 Goals
- Turn any user seed into a **solvable**, internally consistent mystery in under ~90 seconds.
- Evidence feels realistic: chat screenshots, photos, CCTV frames, all AI-generated.
- Culprit is **deducible from evidence** (never random or arbitrary).
- Clean, immersive "detective board" UI.

### 1.2 Non-Goals (v1)
- No multiplayer / real-time collaboration.
- No real video generation (CCTV is a frame sequence, see §7.3).
- No payments, no mobile native app.
- No use of real people, real brands' trademarks as culprits, or real crimes (see §12 Safety).

### 1.3 Tech Stack
| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite, React Router, Tailwind CSS, Zustand (state), Axios |
| Backend | Node.js 20 + Express 4 |
| Database | MongoDB (Mongoose ODM) |
| AI | Google Gemini via `@google/genai` SDK (text + image models, configured by env) |
| Auth | JWT (httpOnly cookie) + bcrypt |
| Storage | Generated images stored on local disk in dev (`/uploads`), S3-compatible/Cloudinary in prod (behind a `StorageService` interface) |
| Validation | Zod (backend schemas and Gemini output validation) |
| Testing | Vitest (frontend), Jest + Supertest (backend) |

---

## 2. User Personas & Core Flow

**Persona:** Casual player who enjoys detective games; may be a guest or registered.

### 2.1 Primary Flow
1. User lands on Home page, types a scenario seed, optionally picks difficulty (Easy / Medium / Hard) and tone (Realistic / Noir / Cozy / Thriller).
2. User clicks **Create Mystery**. A `Case` is created with status `generating`.
3. Frontend shows a progress screen (polls case status every 2s).
4. When status is `ready`, user is routed to the **Case Room**.
5. User browses: Case Brief, Suspects, Evidence (Chats, Images, CCTV, Documents/Notes), and a personal Notes board.
6. User may request up to 3 **hints** (cost points).
7. User selects a culprit and writes a short reasoning (optional but boosts score), then submits the **Accusation**.
8. Server returns verdict: correct/incorrect, full solution reveal, key clue list, score.
9. Case is saved in the user's history; can be replayed (view-only) or shared via link.

### 2.2 Guest vs Registered
- Guests can generate **1 case per browser session** (tracked by signed guest token). Cases are kept 7 days.
- Registered users: up to 10 generations/day (configurable), history persists.

---

## 3. Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | User can submit a seed (10–1000 chars) with difficulty and tone. |
| FR-2 | System generates a case blueprint (hidden truth) and public case file. |
| FR-3 | System generates 3–6 suspects, each with motive, alibi, relationship, personality. |
| FR-4 | System generates evidence: 2–4 chat threads, 3–6 images, 1–2 CCTV sequences, 1–3 documents/notes. Counts scale by difficulty (§7.5). |
| FR-5 | Exactly **one** culprit per case; at least **3 independent clues** point to them; at least **2 red herrings** point elsewhere. |
| FR-6 | Culprit identity and solution are **never** sent to the client before the case is solved or the user gives up. |
| FR-7 | User can accuse one suspect once per attempt; max **2 attempts** per case (configurable). |
| FR-8 | User can use up to 3 progressive hints. |
| FR-9 | User can write private notes and pin evidence to a board. |
| FR-10 | After resolution, show a full reveal: culprit, motive, method, timeline, and which evidence proved what. |
| FR-11 | Registered users can see history and stats (cases solved, accuracy, avg time). |
| FR-12 | Generation failures are retried automatically; user sees clear error + retry option. |
| FR-13 | Case can be shared via public read-only link **only after** it's resolved (spoiler-safe). |

---

## 4. System Architecture

```
React (Vite)  ──HTTPS/JSON──▶  Express API  ──▶  MongoDB
                                   │
                                   ├──▶ Gemini (text: blueprint, chats, docs, hints)
                                   ├──▶ Gemini (image: photos, CCTV frames, screenshots)
                                   └──▶ StorageService (disk / cloud)
```

### 4.1 Generation Pipeline (async job)
Generation is a **background job inside the API process** (simple in-memory queue in v1; interface `JobQueue` so BullMQ/Redis can replace it later). `POST /api/cases` returns immediately with `status: "generating"`.

Stages (each updates `case.progress` and `case.stage`):
1. **blueprint** — Gemini produces the hidden truth (JSON). Validate with Zod. Retry up to 3×.
2. **validate_blueprint** — Deterministic + LLM check for solvability rules (§7.6).
3. **evidence_text** — Generate chat threads and documents from blueprint (JSON).
4. **evidence_images** — Generate image prompts → images (photos, CCTV frames, chat-screenshot backgrounds not needed; chats are rendered in React).
5. **assemble** — Create `Evidence` docs, link to suspects, compute `clueMap`.
6. **finalize** — Set `status: "ready"`.

On unrecoverable failure: `status: "failed"`, store `errorCode`, never leave `generating` forever (timeout 5 min → failed).

---

## 5. Repository Structure (monorepo)

```
ai-mystery-room/
├─ SPEC.md
├─ DECISIONS.md
├─ README.md
├─ package.json            # npm workspaces: client, server
├─ client/
│  ├─ index.html
│  ├─ vite.config.js
│  ├─ tailwind.config.js
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     ├─ api/               # axios instance + per-resource modules
│     ├─ store/             # zustand stores (authStore, caseStore, uiStore)
│     ├─ pages/
│     │  ├─ Home.jsx
│     │  ├─ Login.jsx
│     │  ├─ Register.jsx
│     │  ├─ Generating.jsx
│     │  ├─ CaseRoom.jsx
│     │  ├─ Verdict.jsx
│     │  ├─ History.jsx
│     │  └─ SharedCase.jsx
│     ├─ components/
│     │  ├─ layout/ (Navbar, Footer, ProtectedRoute)
│     │  ├─ case/ (CaseBrief, SuspectCard, SuspectList, AccuseModal, HintPanel, NotesBoard)
│     │  ├─ evidence/ (EvidenceTabs, ChatViewer, ImageViewer, CctvPlayer, DocumentViewer)
│     │  └─ ui/ (Button, Modal, Spinner, Toast, ProgressBar)
│     └─ utils/
└─ server/
   ├─ package.json
   └─ src/
      ├─ index.js
      ├─ app.js
      ├─ config/ (env.js, db.js)
      ├─ models/ (User, Case, Evidence, Attempt)
      ├─ routes/ (auth, cases, evidence, attempts, hints, users)
      ├─ controllers/
      ├─ middleware/ (auth, guest, rateLimit, validate, errorHandler)
      ├─ services/
      │  ├─ gemini/
      │  │  ├─ client.js
      │  │  ├─ prompts/ (blueprint.js, chats.js, documents.js, imagePrompts.js, hints.js)
      │  │  └─ schemas.js   # Zod schemas for every Gemini JSON output
      │  ├─ generation/ (pipeline.js, validators.js, jobQueue.js)
      │  ├─ storage/ (StorageService.js, diskStorage.js, cloudStorage.js)
      │  └─ scoring.js
      ├─ utils/ (logger.js, asyncHandler.js, ApiError.js)
      └─ tests/
```

---

## 6. Data Models (Mongoose)

### 6.1 User
```
_id, email (unique, lowercase), passwordHash, displayName,
role: "user" | "admin" (default "user"),
dailyGenerationCount, dailyGenerationResetAt,
createdAt, updatedAt
```

### 6.2 Case
```
_id,
owner: ObjectId(User) | null,       // null for guests
guestId: String | null,
seed: String,
difficulty: "easy" | "medium" | "hard",
tone: "realistic" | "noir" | "cozy" | "thriller",
status: "generating" | "ready" | "failed" | "solved" | "failed_attempts" | "abandoned",
stage: String, progress: Number (0-100), errorCode: String | null,

// PUBLIC (safe to send to client while playing)
title, tagline,
brief: { setting, date, location, victimOrIncident, summary },
suspects: [{
  suspectId: String,              // "s1", "s2", ...
  name, age, occupation, relationshipToIncident,
  personality, publicStatement, alibiClaim,
  portraitUrl                     // AI image
}],

// PRIVATE (NEVER sent while status is "ready"; select:false)
solution: {
  culpritSuspectId, motive, method, opportunity,
  timeline: [{ time, event, evidenceIds: [ObjectId] }],
  redHerrings: [{ suspectId, explanation, evidenceIds: [ObjectId] }],
  keyClues: [{ evidenceId: ObjectId, explanation }]
},

hintsUsed: Number (0-3),
attemptsUsed: Number,
maxAttempts: Number (default 2),
startedAt, solvedAt,
shareToken: String | null,
expiresAt: Date | null,           // guests: createdAt + 7d (TTL index)
createdAt, updatedAt
```
Indexes: `{owner:1, createdAt:-1}`, `{guestId:1}`, TTL on `expiresAt`, unique sparse on `shareToken`.

### 6.3 Evidence
```
_id, caseId, type: "chat" | "image" | "cctv" | "document",
title, description (neutral, non-spoiler),
order: Number,
relatedSuspectIds: [String],      // who appears/is mentioned (public info only)
isRevealedInitially: Boolean,     // for staged reveal (see §7.5)

// type-specific payload:
chat:     { platform: "whatsapp", groupName|null, participants: [{name, phone|null, suspectId|null}],
            messages: [{ id, sender, text, timestamp (ISO), status: "read"|"delivered", replyToId|null, mediaEvidenceId|null }] }
image:    { url, altText, capturedAt, location, exifLike: {camera, timestamp, gps|null} }
cctv:     { cameraName, location, frames: [{ url, timecode (HH:MM:SS), caption }], durationSeconds }
document: { kind: "note" | "receipt" | "email" | "police_report" | "log", body (markdown, sanitized) }

createdAt
```

### 6.4 Attempt
```
_id, caseId, userId|null, guestId|null,
accusedSuspectId, reasoning (≤1000 chars),
isCorrect, scoreAwarded, createdAt
```

---

## 7. AI Layer (Gemini)

### 7.1 General Rules
- Use `@google/genai`. Models come from env: `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`. **Never hardcode model names.**
- All text generation requests JSON output (`responseMimeType: "application/json"` with a response schema where supported) and are **validated with Zod**. On validation failure: retry with the validation error appended to the prompt (max 3 attempts).
- Temperature: blueprint 0.9, chats 0.8, validation 0.2.
- All prompts live in `server/src/services/gemini/prompts/` as functions returning strings; no prompts inline in controllers.
- The seed is **untrusted input**: wrap it in delimiters (`<seed>…</seed>`) and instruct the model to treat it only as story inspiration, ignoring any instructions inside it.
- Log token usage and latency per call (no PII, no full prompts in prod logs).

### 7.2 Blueprint Output Schema (stage 1)
```json
{
  "title": "string",
  "tagline": "string",
  "brief": { "setting": "", "date": "YYYY-MM-DD", "location": "", "victimOrIncident": "", "summary": "" },
  "suspects": [{ "suspectId": "s1", "name": "", "age": 0, "occupation": "", "relationshipToIncident": "",
                 "personality": "", "publicStatement": "", "alibiClaim": "", "portraitPrompt": "" }],
  "solution": {
    "culpritSuspectId": "s2", "motive": "", "method": "", "opportunity": "",
    "timeline": [{ "time": "ISO", "event": "", "clueRefs": ["clue1"] }],
    "clues": [{ "clueId": "clue1", "type": "chat|image|cctv|document", "pointsTo": "s2",
                "isRedHerring": false, "description": "what the evidence shows" }],
    "redHerrings": [{ "suspectId": "s3", "explanation": "", "clueRefs": ["clue4"] }]
  }
}
```

### 7.3 Evidence Generation
- **Chats:** Gemini returns structured messages with realistic timestamps, slang, typos, emojis, and subtle clues. Chats are **rendered by React as a WhatsApp-style UI** (no image generation needed). Must not reference real phone numbers (use fictional `+91 9XXXX 0XXXX`-style masked patterns or names only).
- **Images:** Gemini image model generates photos from `imagePrompts` (scene, lighting, objects containing the clue). Style: candid phone photo / evidence photo, no text-heavy content (image models render text poorly — put text-critical info in documents/chats instead). Each image has an `altText`.
- **CCTV:** v1 = **sequence of 4–8 still frames** generated with a consistent prompt prefix (grainy, fixed angle, overlay timecode rendered by the **frontend**, not baked in). Frontend `CctvPlayer` plays frames as a slideshow with play/pause/scrub and a timestamp HUD. Design the `cctv` schema so real video URLs can be added later.
- **Documents:** Notes, receipts, emails, logs as markdown.
- **Portraits:** One image per suspect, neutral expression, consistent style, fictional people only.
- If an image fails after 2 retries, replace with a placeholder and mark `isPlaceholder: true`; the corresponding clue must then be carried by a text evidence item (validator enforces this).

### 7.4 Hints (`POST /api/cases/:id/hints`)
- Hint 1: general nudge about *what kind* of evidence to re-check.
- Hint 2: points to a specific evidence item.
- Hint 3: eliminates one innocent suspect with reason.
- Hints are generated from the stored solution server-side; they must **never** name the culprit.

### 7.5 Difficulty Scaling
| | Easy | Medium | Hard |
|---|---|---|---|
| Suspects | 3 | 4 | 5–6 |
| Chat threads | 2 | 3 | 4 |
| Images | 3 | 4 | 6 |
| CCTV sequences | 1 | 1 | 2 |
| Documents | 1 | 2 | 3 |
| Clues pointing to culprit | 4 | 3 | 3 (one is indirect/inferential) |
| Red herrings | 2 | 3 | 4 |
| Clue obviousness | direct | moderate | requires cross-referencing ≥2 items |

### 7.6 Solvability Validator (deterministic + LLM)
Reject and regenerate blueprint if any fail:
1. Exactly one culprit; `culpritSuspectId` exists in suspects.
2. ≥ N culprit-pointing clues per difficulty table, each mapped to a planned evidence item.
3. At least 1 clue directly contradicts the culprit's `alibiClaim`.
4. Every non-culprit suspect has either a verified alibi clue or a red herring that is *explainable*.
5. Timeline is chronologically consistent.
6. LLM check (temp 0.2): "Can a careful reader deduce the culprit from only the evidence list? Return `{solvable: boolean, issues: []}`". `solvable=false` → regenerate (max 2 full regenerations, then fail).

### 7.7 Prompt Safety
- Refuse/neutralize seeds involving: real named individuals, minors in harm scenarios, sexual content, graphic gore, self-harm, hate, real ongoing crimes, or instructions for real-world harm. Return `422` with code `SEED_REJECTED` and a friendly message. Pre-check using a cheap Gemini classification call (`{allowed: boolean, reason}`) plus a basic keyword blocklist.
- Violence tone: "PG-13 detective fiction" (theft, fraud, sabotage, disappearance, mild crime). Murder allowed only non-graphically.

---

## 8. REST API

Base: `/api`. JSON only. Errors: `{ "error": { "code": "STRING", "message": "…", "details": {} } }`.

### 8.1 Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, displayName}` | password ≥ 8 chars; sets httpOnly cookie |
| POST | `/auth/login` | `{email, password}` | sets cookie |
| POST | `/auth/logout` | – | clears cookie |
| GET | `/auth/me` | – | returns user or 401 |
| POST | `/auth/guest` | – | issues signed guest token cookie |

### 8.2 Cases
| Method | Path | Description |
|---|---|---|
| POST | `/cases` | Body `{seed, difficulty, tone}` → `202 {caseId, status}`. Enforces quota & seed safety. |
| GET | `/cases/:id` | Public view (no `solution`). 403 if not owner (except shared+resolved). |
| GET | `/cases/:id/status` | `{status, stage, progress, errorCode}` for polling. |
| GET | `/cases/:id/evidence` | List evidence (public payload). |
| GET | `/cases/:id/evidence/:evidenceId` | Single evidence. |
| POST | `/cases/:id/hints` | Returns next hint; increments `hintsUsed` (max 3). |
| POST | `/cases/:id/accuse` | Body `{suspectId, reasoning?}` → verdict (see 8.3). |
| POST | `/cases/:id/giveup` | Marks `abandoned`, returns full solution. |
| POST | `/cases/:id/retry` | Retry a `failed` generation (owner only). |
| POST | `/cases/:id/share` | Only if resolved. Returns `{shareToken, url}`. |
| GET | `/shared/:token` | Read-only resolved case incl. solution. |
| GET | `/cases` | Current user's/guest's cases (paginated `?page&limit`). |
| DELETE | `/cases/:id` | Owner only; also deletes evidence + stored files. |

### 8.3 Accuse Response
```json
{
  "isCorrect": true,
  "attemptsRemaining": 1,
  "score": 820,
  "status": "solved",
  "reveal": { /* present only if solved or out of attempts: solution + keyClues + redHerrings */ }
}
```
If incorrect and attempts remain: **no reveal**, optionally a generic message ("Not quite—re-examine the timeline").

### 8.4 Users
| GET | `/users/me/stats` | `{casesSolved, casesPlayed, accuracy, avgSolveSeconds, bestScore}` |

---

## 9. Scoring
```
base = 1000 (easy) | 1500 (medium) | 2000 (hard)
- hint penalty: 150 per hint
- time penalty: 1 point per 10 seconds after 5 minutes (cap at 40% of base)
- attempt penalty: 25% of base for a second attempt
+ reasoning bonus: +10% of base if reasoning mentions ≥2 key clue evidence titles/keywords (simple keyword match against keyClues, server-side)
min score on correct answer = 100; incorrect = 0
```
Computed in `services/scoring.js` with unit tests.

---

## 10. Frontend Specification

### 10.1 Routes
| Path | Page | Auth |
|---|---|---|
| `/` | Home (seed form + examples + recent cases) | public |
| `/login`, `/register` | Auth | public |
| `/case/:id/generating` | Progress screen | owner |
| `/case/:id` | Case Room | owner |
| `/case/:id/verdict` | Verdict & reveal | owner |
| `/history` | Past cases | registered |
| `/shared/:token` | Shared case (read-only) | public |

### 10.2 Home Page
- Textarea (10–1000 chars, live counter), difficulty segmented control, tone select, 4 clickable example seeds, **Create Mystery** button.
- Disable button while submitting; show quota remaining for the user.

### 10.3 Generating Page
- Animated "investigation being assembled" UI with stage labels from `stage` (Drafting the case → Building suspects → Collecting chats → Developing photos → Pulling CCTV → Finalizing).
- Polls `/status` every 2s; on `ready` → redirect; on `failed` → show error + **Retry**.

### 10.4 Case Room Layout (desktop: 3 columns; mobile: tabs)
- **Left:** Case brief + suspect list (cards with portrait, name, role, public statement, alibi).
- **Center:** Evidence tabs — *Chats · Images · CCTV · Documents*.
  - `ChatViewer`: WhatsApp-style bubbles, group name header, timestamps, read ticks, date separators, replies.
  - `ImageViewer`: gallery grid + lightbox with alt text and "captured at / location" metadata.
  - `CctvPlayer`: frame slideshow, play/pause, scrubber, timecode HUD, camera name, scanline/grain CSS overlay.
  - `DocumentViewer`: sanitized markdown (use `react-markdown` + `rehype-sanitize`).
- **Right:** Notes board (textarea + pin evidence chips; autosaved to `localStorage` keyed by case id), hints panel (hints used counter + "Get hint" button with confirm), **Accuse** button (opens `AccuseModal`).
- `AccuseModal`: radio list of suspects, reasoning textarea, confirm step ("Are you sure? X attempts remaining").

### 10.5 Verdict Page
- Correct/incorrect banner, score breakdown, full story reveal (culprit, motive, method, timeline with evidence links), "key clues" list, red herring explanations, **Share** and **New Mystery** buttons.

### 10.6 Design
- Dark detective theme: charcoal background, warm amber accent, monospaced headings for case-file feel, paper-texture cards. Fully responsive (≥360px). Keyboard accessible, visible focus rings, alt text on all images, WCAG AA contrast.
- Loading skeletons for evidence; toast notifications for errors.

### 10.7 State
- `authStore` (user, guest), `caseStore` (current case, evidence, hints, attempt state), `uiStore` (modals, toasts). Server is source of truth; no solution data ever held in client state until revealed.

---

## 11. Security & Reliability

- **Secrets:** all keys in `.env`, never committed. `.env.example` provided.
- **Auth:** bcrypt cost 12; JWT 7d in httpOnly, SameSite=Lax, Secure (prod) cookie; CSRF mitigated via SameSite + custom header check on mutating requests.
- **Authorization:** every case/evidence route verifies ownership (user or guest token) except `/shared`.
- **Spoiler protection:** `solution` has `select: false`; only the accuse/giveup/shared controllers explicitly select it, and only when status allows. Add a test asserting no public endpoint returns `solution` for an active case.
- **Rate limiting:** `express-rate-limit` — global 100 req/15min/IP; `POST /cases` 5/hour/IP + daily quota per user; auth routes 10/15min.
- **Validation:** Zod on every request body/query/param. Sanitize output markdown. `helmet`, `cors` restricted to `CLIENT_URL`, body size limit 100kb.
- **Gemini failures:** exponential backoff (1s, 2s, 4s) on 429/5xx; hard timeout 60s per call; total pipeline timeout 5 min.
- **Cost control:** cap images per case (≤ 14 total including portraits); global daily generation ceiling configurable via env (`MAX_DAILY_GENERATIONS`).
- **Logging:** `pino`; no PII or full prompts in prod.
- **Cleanup:** TTL index for guest cases; cron (node-cron) deletes orphan files nightly.

---

## 12. Content Safety
- See §7.7 for seed screening. Additionally, generated portraits/images must depict **fictional adults only**; prompts include "fictional person, not resembling any real individual".
- Disclaimer shown on Home & Case Room: *"All cases, people, messages, and images are fictional and AI-generated."*
- Report button on each case (stores a report doc; admin review out of scope for v1).

---

## 13. Configuration (`.env.example`)

```
# Server
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017/ai-mystery-room
JWT_SECRET=change-me
GUEST_TOKEN_SECRET=change-me

# Gemini
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=
GEMINI_IMAGE_MODEL=

# Limits
DAILY_GENERATIONS_USER=10
GUEST_MAX_CASES=1
MAX_ATTEMPTS=2
MAX_DAILY_GENERATIONS=500

# Storage
STORAGE_DRIVER=disk        # disk | cloud
UPLOAD_DIR=./uploads
CLOUD_* =                  # provider-specific when STORAGE_DRIVER=cloud
```

---

## 14. Testing Requirements

**Backend (Jest + Supertest, Gemini mocked):**
- Auth flows; guest quota; ownership checks.
- Zod schema tests with valid/invalid Gemini outputs.
- Validator tests: reject blueprints with 0 culprit clues, missing alibi contradiction, bad timeline.
- Spoiler test: `GET /cases/:id` never contains `solution` while `status` ∈ {generating, ready}.
- Scoring unit tests for each penalty/bonus.
- Accuse: correct, incorrect with attempts left, incorrect final attempt (reveals), double-submit prevention.

**Frontend (Vitest + React Testing Library):**
- Seed form validation; polling hook; ChatViewer rendering; CctvPlayer controls; AccuseModal flow.

**Manual QA checklist:** run 3 seeds per difficulty; confirm each is solvable by reading only the evidence.

---

## 15. Build Plan (suggested order for Codex)

1. **Scaffold** monorepo, lint/prettier, env loading, Mongo connection, health route.
2. **Auth** (register/login/guest/me) + middleware.
3. **Models** + Zod schemas + StorageService (disk).
4. **Gemini client** + blueprint prompt + validators + mocked tests.
5. **Pipeline** + job queue + status endpoint; evidence text generation.
6. **Image generation** (portraits, photos, CCTV frames) with placeholder fallback.
7. **Cases/Evidence/Accuse/Hints/Giveup/Share** endpoints + scoring.
8. **Frontend shell**: routing, stores, Home, Generating.
9. **Case Room**: evidence viewers (Chat, Image, CCTV, Document), suspects, notes, hints, accuse flow.
10. **Verdict, History, Shared** pages.
11. Polish: responsive layout, accessibility, error states, rate limit UX.
12. Full test pass + README with setup instructions.

---

## 16. Acceptance Criteria (Definition of Done)

- [ ] A new seed produces a `ready` case within 120s in ≥ 90% of runs (dev conditions).
- [ ] Every generated case passes the solvability validator before being marked `ready`.
- [ ] No network response before resolution contains the culprit ID or `solution`.
- [ ] All four evidence types render correctly on desktop and mobile.
- [ ] Accuse → verdict → reveal → share flow works end to end for guests and registered users.
- [ ] Rate limits, quotas, and seed safety rejections return the documented error codes.
- [ ] All tests in §14 pass; `npm run dev` starts client + server from repo root; README documents setup.

---

## 17. Future Scope (do NOT build in v1)
Real video generation, voice-call audio evidence, multiplayer/leaderboards, user-uploaded evidence, interrogation chat with suspects (AI role-play), daily challenge, localization.
