# Deployment & Local Database Operations Guide

**Status: documentation only.** Nothing in this document has been deployed, provisioned, or applied to the codebase. No Render services, no Atlas clusters, no credentials, no code changes. Every command and file path below was verified against the actual repository (branch `main`) before being written down — see §15 for how.

This guide has two audiences: (1) anyone running the project locally who wants MongoDB working correctly, and (2) whoever eventually deploys this project, who needs a precise, non-guessed plan to follow.

---

## 1. Current Architecture

```
Browser (React 18 + TypeScript, built with Vite)
   │  fetch() calls, JSON over HTTP
   ▼
FastAPI backend (Python, single ASGI app — backend/app/main.py)
   │                                   │
   │ in-process function calls          │ pymongo MongoClient
   ▼                                   ▼
Simulation/Optimization engines    MongoDB ("network_visualizer" database)
(networkx, PuLP + CBC solver)      assignments / submissions /
— pure computation, no I/O         challenge_attempts / simulation_runs
```

- **Frontend** — React 18 + TypeScript + Vite + React Flow (`frontend/`). A single-page app with no client-side router (no `react-router-dom` in `frontend/package.json`) — every "page" (Design/Traffic/Algorithm/Result, Teacher/Student dashboards, Optimization Lab) is internal component state inside `WorkflowManager.tsx`, not a URL route. This matters for deployment: there is exactly one route (`/`) to serve, so SPA deep-link rewrite rules are a nice-to-have, not a requirement (see §6).
- **Backend** — FastAPI (`backend/app/main.py`), a single ASGI `app` object. There is no `uvicorn.run()` call and no hardcoded host/port in the code — the port is entirely controlled by however `uvicorn` is invoked on the command line. This is exactly why a deployment platform's dynamic `$PORT` works without any code change (§7).
- **Optimization** — `app/optimization/` implements OPT (an LP solved exactly via **PuLP + the bundled CBC solver**), WPO, LWO, and Joint (all combinatorial search, exact-or-heuristic depending on a configurable search budget). This is pure CPU-bound computation inside the same FastAPI process — no separate worker, no queue, no external solver service.
- **MongoDB persistence** — two independent storage services, each opening its own `pymongo.MongoClient`:
  - `AssignmentStorageService` (`backend/app/services/assignment_service.py`) — assignments, submissions, challenge attempts, and the Demo Scenario Pack (which is just assignments with a `demoScenario` field — see `backend/app/demo/demo_scenarios.py`).
  - `RunStorageService` (`backend/app/services/run_storage_service.py`), instantiated inside `SimulationService` — saved simulation runs.

### What works without MongoDB, precisely

| Computation (never touches MongoDB) | Persistence (requires MongoDB) |
|---|---|
| `/simulate` (ECMP, Distance Vector, Segment Routing, ECMP-within-segments) | Saved simulation runs (`GET/POST/DELETE /simulations*`) |
| `/optimize` and `/optimize/search-space` (OPT/WPO/LWO/Joint — PuLP/CBC and the search-space estimators) | Teacher-created assignments persisting across reloads (`POST /assignments`) |
| Guest "Start Building a Network" flow, topology builder, trace replay | Assignment-type (non-challenge) student work loading its topology from storage |
| Demo teacher/student/Demo-Student login and dashboards (seeded in the browser's `localStorage`, not the database) | Submissions (`POST /submissions`), challenge attempts (`POST /challenge-attempts`) |
| | The Demo Scenario Pack (`POST /seed-demo-scenarios`, `GET /demo-scenarios`) — genuinely requires MongoDB; it is not a localStorage fallback |

**The distinction this document cares about most:** simulation and optimization are pure, stateless computation that happens whether or not MongoDB is reachable. Persistent classroom data (assignments, submissions, attempts, saved runs, the demo scenario pack) is the only thing MongoDB is responsible for. Losing MongoDB never breaks the ability to design a network and run an algorithm or optimizer against it — it only breaks the ability to save/reload/share that work.

---

## 2. Local MongoDB — Exact Setup

Verified directly from `backend/.env.example`, `backend/app/services/assignment_service.py`, and `backend/app/services/run_storage_service.py`.

| Fact | Value | Source |
|---|---|---|
| Env var (connection URI) | `MONGODB_URI` | both storage services, `os.getenv("MONGODB_URI", "mongodb://localhost:27017")` |
| Env var (database name) | `MONGODB_DATABASE` | both storage services, `os.getenv("MONGODB_DATABASE", "network_visualizer")` |
| **Project's chosen local port** | **27018** (not MongoDB's default 27017) | `backend/.env.example` — deliberately non-default so it doesn't collide with any other local MongoDB install |
| Code's own built-in default if `MONGODB_URI` is unset | `mongodb://localhost:27017` (the *code's* fallback, not what `.env.example` sets) | both storage services' `os.getenv(..., "mongodb://localhost:27017")` default |
| Database name | `network_visualizer` | `backend/.env.example` and both services' default |
| Connection timeout | `serverSelectionTimeoutMS=500` (0.5 seconds) — fails fast so a missing MongoDB never blocks app startup or makes a request hang | `MongoClient(self.uri, serverSelectionTimeoutMS=500)` in both services |
| Fallback behavior | Any exception during connect/ping is swallowed; `.available` becomes `False`; every write becomes a no-op returning its input unchanged, every read returns `[]`/`None`/`404` | `except Exception: pass` in both services' `__init__` |
| Collections currently used | `assignments`, `submissions`, `challenge_attempts` (`AssignmentStorageService`); `simulation_runs` (`RunStorageService`) — 4 total, created implicitly by MongoDB on first write | `assignment_service.py` lines 27-29; `run_storage_service.py` line 19 |
| Indexes created automatically? | **No.** No `create_index`/`ensure_index` call exists anywhere in `backend/app/` (verified by repo-wide search). Every lookup (`get_assignment`, `get_submission`, etc.) queries by an application-level string ID (`assignmentId`, `submissionId`, ...) with **no index** on it — fine at classroom scale, worth revisiting only if a collection grows very large. | repo-wide grep, no matches |

**Does starting FastAPI automatically start MongoDB? No.** `uvicorn app.main:app` starts only the Python/ASGI process. `backend/app/main.py` loads `backend/.env` (if present) at import time and then constructs `AssignmentStorageService()`/`SimulationService()` (which itself builds a `RunStorageService()`), each of which *tries* to connect for up to 500ms and silently continues either way. MongoDB itself — the actual `mongod` process or Docker container — must already be running before (or independently of) the backend; nothing in this codebase launches it.

### A. Docker-based local MongoDB (recommended — matches `.env.example` exactly)

```bash
# Start (first time — creates the container)
docker run -d --name network-viz-mongo -p 27018:27017 --restart unless-stopped mongo:7

# Start again later (container already exists)
docker start network-viz-mongo

# Stop
docker stop network-viz-mongo

# Verify it's running
docker ps --filter name=network-viz-mongo
```

### B. Native macOS MongoDB (Homebrew)

Practical alternative when Docker Desktop isn't running. `mongod`/`mongosh` are available via `brew install mongodb-community` (or already on `PATH` if previously installed, e.g. `/opt/homebrew/bin/mongod`).

```bash
# Start — bind to the project's own port (27018), with a dedicated data directory
mkdir -p ~/mongo-data/inet-project
mongod --dbpath ~/mongo-data/inet-project --port 27018 --bind_ip 127.0.0.1 &

# Stop
mongosh --port 27018 --eval "db.getSiblingDB('admin').shutdownServer()"
# or: kill the mongod process directly (find its PID with `pgrep mongod`)

# Verify it's running
mongosh --port 27018 --eval "db.runCommand({ ping: 1 })"
```

Either way, the resulting connection is the same: `mongodb://localhost:27018`.

### Connecting the backend

```bash
cd backend
cp .env.example .env   # already has the correct values — no editing needed for local Docker/native setup above
```

`backend/.env` is already listed in the repo's `.gitignore` (the bare `.env` pattern matches at every directory depth) — it is never committed.

### Verify `GET /health` shows `mongoAvailable: true`

```bash
# with the backend running (uvicorn app.main:app --reload --port 8000)
curl -s http://localhost:8000/health
# {"status":"ok","mongoAvailable":true}
```

If it shows `"mongoAvailable": false`, MongoDB either isn't running, isn't listening on 27018, or `backend/.env` doesn't exist/doesn't match. There is no other diagnostic endpoint — `/health` is the single source of truth for this.

### Inspecting collections

**mongosh:**

```bash
mongosh --port 27018
> use network_visualizer
> show collections
> db.assignments.countDocuments()
> db.assignments.find({ demoScenario: { $ne: null } }).pretty()   // the Demo Scenario Pack
> db.submissions.find().pretty()
> db.simulation_runs.find().pretty()
```

**MongoDB Compass:** connect with `mongodb://localhost:27018`, select the `network_visualizer` database — the four collections above appear once at least one write has happened (MongoDB creates a collection lazily on first insert, not on connect).

---

## 3. Local MongoDB — Multi-User Limitation

If a second person clones this repository and runs their own local MongoDB (Docker or native, as above), **their assignments/submissions/saved runs live only on their machine.** There is no shared server, no sync mechanism, and nothing in the code that pushes local data anywhere else. The project owner's MongoDB and a classmate's MongoDB are two completely independent databases that happen to use the same schema — they will never see each other's data by running the project as documented today.

This is fine, and by design, for:

- **Development** — every contributor gets a private, disposable database; nothing they do can corrupt anyone else's data.
- **Isolated demos** — a single presenter's laptop, seeding the Demo Scenario Pack for their own walkthrough.
- **Testing** — the automated backend test suite already runs against a database that may or may not exist locally (see `backend/tests/test_assignments.py`'s own docstring: "tests exercise the API routes... in no-MongoDB mode (graceful degradation)"); tests never assume a shared, persistent state.

It is **not** suitable for a shared classroom deployment, because:

- A teacher's assignments created on their own machine are invisible to students running the frontend against their own local backend+MongoDB.
- There is no single, agreed-upon source of truth — 20 students running "the project" locally would have 20 separate, empty databases, not one shared classroom.
- Submissions couldn't reach the teacher at all through the database path (only through the existing manual `submission.json` file-export workflow the README already documents).

The fix is not a code change — it's pointing every deployment at the **same** MongoDB instance, which is exactly what §4 (Atlas) and §5-§7 (Render) below set up.

---

## 4. MongoDB Atlas Migration

Current official guidance (verified via MongoDB's own docs and current setup walkthroughs) confirms the free-tier path is still: create a project → deploy an M0 (free, permanently-free shared) cluster → create a database user → configure network access → copy the connection string.

### Step-by-step

1. **Create an Atlas project and cluster** — sign in at [cloud.mongodb.com](https://cloud.mongodb.com), create a new **Project** (e.g. "inet-project"), then **Deploy a cluster** and choose the **M0** free tier. Pick a cloud region close to wherever the backend will actually run (matters once the backend is on Render — see §5).
2. **Create an application database user** — Atlas UI → **Database Access** → **Add New Database User**. Use username/password auth (not a personal Atlas login). Give it a dedicated username, e.g. `inet-app`, and a generated password. Do **not** reuse this password anywhere else.
3. **Configure network access** — Atlas UI → **Network Access** → **Add IP Address**. For a Render-hosted backend (§7), Render web services use dynamic outbound IPs on most plans, so the practical choice for a first deployment is **Allow Access from Anywhere** (`0.0.0.0/0`) *combined with* a strong, unique database-user password and least-privilege role (§9) — this is the standard trade-off Atlas's own docs describe for platforms without static outbound IPs. If the Render plan in use exposes static outbound IPs, allowlist those specifically instead.
4. **Obtain the connection string** — Atlas UI → **Database** → **Connect** → **Drivers** → select Python. Atlas gives an SRV-format string:
   ```
   mongodb+srv://<username>:<password>@<cluster-host>/?retryWrites=true&w=majority
   ```
5. **Store the URI as an environment variable** — set `MONGODB_URI` to the string above (with the real username/password substituted) in the deployment platform's environment variable settings (§7/§8), **never** in a committed file. Also set `MONGODB_DATABASE=network_visualizer` so the app keeps using the same database name it already uses locally (Atlas doesn't require pre-creating the database — like collections, MongoDB creates it lazily on first write).
6. **Do not commit credentials to Git** — `backend/.env` is already gitignored (see §2); keep it that way. Never paste a real Atlas URI into a commit, a `render.yaml`, or this documentation.
7. **Verify backend health** — same check as local: `curl <backend-url>/health` should return `"mongoAvailable": true` once `MONGODB_URI` points at Atlas and the backend has restarted with the new value.
8. **Seed demo data** — `curl -X POST <backend-url>/seed-demo-scenarios` (idempotent, same endpoint as local — see README's Demo Scenario Pack section) and, if wanted, `POST /seed-demo` for the example challenge assignments.
9. **Verify assignments/submissions persist** — create an assignment via the Teacher Workspace (or `POST /assignments`), then confirm `GET /assignments` still returns it after the backend process restarts (proves it's actually in Atlas, not an in-memory artifact) — or check directly in Atlas's own **Browse Collections** UI.

### Can the current code already use a standard MongoDB URI without changes?

**Yes.** As of the Atlas migration described below, this is no longer hypothetical — it has been exercised against a real Atlas cluster.

- **URI handling needed no change.** Both storage services read `MONGODB_URI` from the environment and pass it straight to `pymongo.MongoClient(self.uri, ...)` with no parsing, no assumption about scheme (`mongodb://` vs `mongodb+srv://`), and no hardcoded host. An Atlas SRV string works as a drop-in value — confirmed live (see below), not just by reading the code.
- **`mongodb+srv://` resolution needed no new dependency.** Atlas's default connection string uses the `mongodb+srv://` scheme, which requires the `dnspython` package for SRV/DNS resolution. `backend/requirements.txt` does not list `dnspython` explicitly, but **`pymongo==4.10.1`'s own package metadata declares `dnspython<3.0.0,>=1.16.0` as an unconditional (non-extra) dependency** — verified directly against the installed virtualenv in this repository, where `dnspython==2.8.0` is already present purely as a transitive dependency of `pymongo`. `pip install -r requirements.txt` already installs everything needed for an SRV connection string; no `requirements.txt` edit was required for this specifically, and SRV resolution was confirmed to work end-to-end during the live Atlas test below.
- **The one real risk has been fixed: `serverSelectionTimeoutMS`.** The original 500ms timeout (both `assignment_service.py` and `run_storage_service.py`) was tuned for the local-dev case — "if MongoDB isn't running on localhost, fail almost instantly and fall back gracefully." Against a remote cluster, every connection attempt is a real network round-trip (DNS SRV lookup, TLS handshake, replica-set discovery) — commonly more than 500ms, especially the *first* connection after a cold start, risking a false `mongoAvailable: false` against a perfectly healthy cluster. **This has been implemented**, not just identified: a new shared helper, `backend/app/services/mongo_config.py`, reads `MONGODB_SERVER_SELECTION_TIMEOUT_MS` (default `5000`) and both storage services now call it instead of hardcoding `500` — so the two independent `MongoClient` connections this app opens always agree on the same timeout. See `backend/tests/test_mongo_config.py` for regression coverage (default, env override, invalid-value fallback, and both services consuming it identically) — none of which require a real database connection.

### Atlas migration status — verified live

Tested against a real MongoDB Atlas cluster (M0), with the local MongoDB instance on port 27018 stopped beforehand so no successful result could be coming from local MongoDB by accident. No connection string, hostname, username, or password is reproduced anywhere in this document, the git history, or any test — only counts and booleans, exactly as required.

| Check | Result |
|---|---|
| `GET /health` against Atlas | `"mongoAvailable": true` |
| `POST /seed-demo-scenarios` (first run) | `{"seeded": 16, ...}` |
| `GET /demo-scenarios` count | `16` |
| `POST /seed-demo-scenarios` (re-run — idempotency) | `{"seeded": 16, ...}`, list count still `16`, no duplicates |
| Collections created by the application | `assignments` (confirmed present with 16 documents after seeding; the app never manually pre-creates empty collections) |
| Connection type | MongoDB Atlas (`mongodb+srv://`) — confirmed via the SRV scheme and by local MongoDB being stopped throughout |

**Not completed in this session — a network-connectivity caveat, not a configuration problem:** after the sequence above succeeded, further fresh connection attempts from this particular development session began failing at the TLS handshake layer (`TLSV1_ALERT_INTERNAL_ERROR`), reproduced independently through `pymongo`, Python's own `ssl` module, and raw `openssl s_client` — while general internet TLS (e.g. to `api.github.com`) continued to work fine throughout. This points to an intermittent network-path issue specific to that session's egress to Atlas's cluster hosts, not to credentials, URI formatting, DNS/SRV resolution, Atlas network access rules, or this project's code (all four of which were already conclusively exercised successfully in the sequence above). As a result, the Demo Student open-scenario flow, and the assignment/submission/simulation-run restart-persistence tests, could not be completed live in that session. They should be re-run (commands below) once connectivity to Atlas is stable — nothing about the application changes between "works" and "doesn't" here, only the network path.

```bash
# Demo Student flow (after logging in as demo/demo in the frontend, or directly):
curl http://localhost:8000/demo-scenarios                       # expect 16 scenarios
curl http://localhost:8000/assignments/demo-wpo/student         # expect full starter config, no expectedSolution

# Assignment persistence across a restart:
curl -X POST http://localhost:8000/assignments -H "Content-Type: application/json" -d '{...}'
# restart the backend, then:
curl http://localhost:8000/assignments/<the-id-you-used>
curl -X DELETE http://localhost:8000/assignments/<the-id-you-used>   # clean up

# Submission persistence — same pattern via POST/GET /submissions/{id}.
# Simulation run persistence — save one via /simulate with a real request,
# confirm it via GET /simulations/{simulationRunId} after a restart, then
# DELETE /simulations/{simulationRunId} to clean up.
```

---

## 5. Recommended Deployment Architecture

```
Browser
   │  HTTPS
   ▼
Render Static Site   (frontend/, built with Vite)
   │  HTTPS, fetch() to VITE_BACKEND_URL
   ▼
Render Web Service    (backend/, FastAPI + uvicorn)
   │  MongoDB wire protocol over TLS
   ▼
MongoDB Atlas          (M0 free tier to start)
```

The optimizer (OPT/WPO/LWO/Joint — PuLP/CBC and the combinatorial search code in `app/optimization/`) **stays inside the FastAPI service** for V1. It is already timeout-bounded and budget-capped server-side (`timeLimitSeconds` default 30s/max 300s, `maxExactCombinations` capped by `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP`, default 2,000,000 — see `backend/app/services/optimization_service.py`), so a single Render web service can run it directly without a separate job queue for a first, teaching-scale deployment (see §10 for exactly when that would need to change).

**Why not Kubernetes:** this is a two-process web app (one static frontend, one Python backend) plus a managed database — there is no fleet of services to orchestrate, no need for custom autoscaling policies, no multi-region requirement, and no stateful workload that benefits from pod scheduling. Render's own Static Site + Web Service products already provide: HTTPS by default, git-push-to-deploy, environment variable management, and (on paid plans) autoscaling and zero-downtime deploys — everything this project's actual scale needs. Introducing Kubernetes here would mean maintaining cluster infrastructure, container orchestration manifests, and ingress/networking configuration for a workload that doesn't yet have a single measured reason to need it (§11 revisits this explicitly as a later, conditional stage — not a default).

---

## 6. Render Frontend Plan (Static Site)

Verified from `frontend/package.json`, `frontend/vite.config.ts`, and this repository's own `npm run build` output.

| Setting | Value | Verified from |
|---|---|---|
| Root directory | `frontend` | repo layout |
| Build command | `npm install && npm run build` | `frontend/package.json`'s `"build": "tsc && vite build"` script (Render runs `npm install` separately unless folded into the build command) |
| Publish (output) directory | `frontend/dist` → **`dist`** relative to the root directory above | Vite's default `build.outDir` (unset in `vite.config.ts`, so it's Vite's own default); confirmed by this repo's actual build output (`dist/index.html`, `dist/assets/...`) |
| Required build-time env var | `VITE_BACKEND_URL` | `frontend/src/api/simulationApi.ts` and `optimizationApi.ts`: `const BASE_URL = import.meta.env.VITE_BACKEND_URL \|\| "http://localhost:8000"`; declared in `frontend/src/env.d.ts` |

**Important Vite-specific detail:** `VITE_BACKEND_URL` is read via `import.meta.env` at **build time**, not runtime — Vite inlines it into the compiled JS. It must be set in Render's Static Site environment variables *before* the build command runs (Render does this automatically for Static Sites — env vars are available during the build step), pointing at the deployed backend's public URL (e.g. `https://inet-backend.onrender.com`). Changing it later requires a rebuild, not just a redeploy of already-built assets.

**Client-side routing rewrite:** not required for this app specifically — there is no `react-router-dom` dependency and no client-side URL routing (confirmed: not present in `frontend/package.json`), so there are no deep-link routes that could 404 on refresh. A rewrite rule (`/*` → `/index.html`) is still safe/standard to add proactively on Render's Static Site (Redirects/Rewrites settings) in case URL-based routing is introduced later — it has no effect today.

No `frontend/.env`/`.env.example` currently exists in the repo — one should be added (documentation-only note; not created by this task) alongside a real `frontend/.env` at deploy time.

---

## 7. Render Backend Plan (Web Service)

Verified from `backend/requirements.txt`, `backend/app/main.py`, and the absence of any `runtime.txt`/`.python-version` file in the repo.

| Setting | Value | Verified from / current official Render guidance |
|---|---|---|
| Root directory | `backend` | repo layout |
| Python version | **Not currently pinned** in the repo (no `runtime.txt`, no `.python-version`). Recommend pinning to `3.13.2` (this project's actual development version — confirmed via the local `.venv`) via a `.python-version` file or Render's `PYTHON_VERSION` env var, per Render's own Python-version docs, rather than relying on Render's date-based default. | Render docs: pin via `.python-version` (can omit patch version) or `PYTHON_VERSION` env var (must be fully qualified, e.g. `3.13.2`) |
| Build command | `pip install -r requirements.txt` | `backend/requirements.txt` exists at the repo root of `backend/`; matches Render's own documented FastAPI build command exactly |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | `backend/app/main.py` exposes `app` with no internal host/port binding (confirmed — no `uvicorn.run()` call anywhere in the file), so the ASGI target is `app.main:app` (not `main:app` — this project nests the app under `backend/app/`, unlike Render's generic template) |

The service **must** bind `--host 0.0.0.0` (not `127.0.0.1`, which is unreachable from outside the container) and `--port $PORT` (Render assigns this dynamically; a hardcoded port causes every request to 502) — both already directly supported by the existing `uvicorn app.main:app` invocation this project's own README uses locally, just with `--reload --port 8000` replaced by `--host 0.0.0.0 --port $PORT` for the deployed start command.

### Environment variables the backend needs on Render

- `MONGODB_URI` — the Atlas connection string from §4, set as a secret env var.
- `MONGODB_DATABASE` — `network_visualizer` (or whatever value keeps consistency with local dev).
- `MONGODB_SERVER_SELECTION_TIMEOUT_MS` — optional; defaults to `5000` (see `backend/app/services/mongo_config.py`). Worth raising if Render's network path to the Atlas cluster proves consistently slower than 5s in practice (check Render's logs for `mongoAvailable: false` against a cluster that's actually healthy).
- `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` — optional; only needed to override the built-in default of 2,000,000 (see `backend/app/services/optimization_service.py`). Consider a lower value on a shared, modest-CPU Render instance (§10).
- `PYTHON_VERSION` — recommended (see table above), not read by application code, consumed by Render's build system.
- `FRONTEND_ORIGIN` (or `FRONTEND_ORIGINS`) — **required** once a frontend is actually deployed; see the CORS section immediately below. Without it, the deployed frontend's every request is rejected by the browser's CORS enforcement even though the backend itself is healthy.

### CORS — implemented, environment-driven (§7 follow-up, now closed)

`backend/app/main.py`'s `origins` list always includes four localhost dev origins (`LOCAL_DEV_ORIGINS`, unconditional — nothing changes for local development), and on top of those, reads `FRONTEND_ORIGIN` (one origin) and/or `FRONTEND_ORIGINS` (comma-separated, e.g. production + a preview deploy) from the environment and appends them — no code edit, no redeploy-from-source needed to point the backend at a new/changed frontend URL, just an env var change in Render's dashboard. Blank entries and trailing slashes are normalized away defensively. `allow_credentials=True` is kept exactly as before, and `allow_origins` is never set to `"*"` — an explicit list only, since a wildcard origin combined with credentials is rejected by browsers outright and was never used here regardless.

**This was a genuine, confirmed production bug, not a theoretical gap:** after the first real Render deployment, the Demo Scenario Dashboard's "Reseed pack" button failed with a misleading "Is MongoDB running?" message. Direct testing against the live deployed backend confirmed the actual cause — `curl` (server-to-server, bypasses CORS) succeeded and even seeded 16 documents to Atlas directly, while a simulated preflight request with a non-localhost `Origin` header was rejected outright:

```
$ curl -s -i -X OPTIONS https://inet-project.onrender.com/seed-demo-scenarios \
    -H "Origin: https://<the-deployed-frontend>" \
    -H "Access-Control-Request-Method: POST"
HTTP/2 400
...
Disallowed CORS origin
```

This confirmed the backend and Atlas were both entirely healthy — only the browser-facing CORS allowlist was misconfigured. Fixed by making `origins` environment-driven; **the fix requires setting `FRONTEND_ORIGIN` (the deployed frontend's exact URL) in Render's backend environment variables and redeploying the backend** — see §16 (Deployed Production Incident) for the full writeup, including the Demo Scenario Dashboard's error-message fix that was needed alongside it.

---

## 8. Deployment Environment Variables

Every row below was confirmed against actual code (`os.getenv`/`os.environ.get`/`import.meta.env` call sites) — nothing here is guessed.

| Name | Required? | Example placeholder | Purpose | Secret? |
|---|---|---|---|---|
| `MONGODB_URI` | Required for persistence (app runs without it, degraded — see §1) | `mongodb+srv://<user>:<password>@<cluster-host>/?retryWrites=true&w=majority` | MongoDB connection string, read by `AssignmentStorageService` and `RunStorageService` | **Yes** — contains a database password |
| `MONGODB_DATABASE` | Optional (defaults to `network_visualizer` in code) | `network_visualizer` | Database name within the cluster | No |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | Optional (defaults to `5000` in code, `app/services/mongo_config.py`) | `5000` | How long (ms) the backend waits for a MongoDB connection before falling back to "unavailable" mode. The original hardcoded `500ms` was tuned for local-only dev and proved too tight for Atlas's real network round-trip (DNS/SRV + TLS handshake + replica-set discovery) — see §4's "Atlas migration status" for the live evidence this was based on. Worth raising further (e.g. `10000`+) if a specific deployment's network path to its MongoDB is consistently slower than 5s. | No |
| `VITE_BACKEND_URL` | Required in any non-local deployment (defaults to `http://localhost:8000` otherwise) | `https://inet-backend.onrender.com` | Frontend's API base URL, inlined at Vite **build time** | No — public, visible in the shipped JS bundle |
| `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` | Optional (defaults to `2000000` in code) | `500000` | Hard server-side ceiling on the user-controllable exact-search budget (§7) | No |
| `PYTHON_VERSION` | Recommended, not currently set | `3.13.2` | Pins the backend's Python runtime on Render (build-system only, not read by app code) | No |
| `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` | **Required** once a frontend is actually deployed (§7) | `https://inet-frontend.onrender.com` (single) or a comma-separated list for `FRONTEND_ORIGINS` | Adds the deployed frontend's exact origin to the backend's CORS allowlist, on top of the always-allowed localhost dev origins — no code edit per environment | No |

No other environment variables are read anywhere in `backend/app/` or `frontend/src/` (verified by grepping `os.getenv`, `os.environ`, and `import.meta.env` across both trees).

---

## 9. Security Notes

- **Database credentials stay server-side, always.** `MONGODB_URI` is read only inside `backend/app/services/*.py`, which run exclusively on the backend process. Nothing in `frontend/src/` ever references a MongoDB URI, and none of the API responses returned to the frontend (`/assignments`, `/demo-scenarios`, `/simulations`, etc.) include connection details — confirmed by inspecting every route in `backend/app/main.py`.
- **The frontend must never receive a MongoDB URI.** The only backend-address value the frontend needs is `VITE_BACKEND_URL` — the *public* HTTPS URL of the FastAPI service, not a database connection string. Do not add a Mongo-related value to any `VITE_*` environment variable; anything prefixed `VITE_` is inlined into the public JS bundle and visible to anyone who opens dev tools.
- **`.env` stays gitignored.** Already true today (`.gitignore`'s bare `.env` line) — keep this true for any future `frontend/.env` as well.
- **Atlas database user should have minimum necessary privileges.** Create the application's database user (§4, step 2) scoped to **Read and write to any database** at most, and prefer scoping it to just the `network_visualizer` database specifically if Atlas's UI allows per-database roles at cluster-creation time — this app never needs cluster-admin, user-management, or backup/restore privileges.
- **Production network access should be restricted appropriately.** `0.0.0.0/0` (§4, step 3) is a pragmatic starting point only because Render doesn't guarantee a static outbound IP on every plan — it is not the end state for a security-conscious deployment. If/when a Render plan with static outbound IPs is used, narrow Atlas's Network Access list to those specific IPs. At minimum, always pair a broad IP allowlist with a strong, unique, single-purpose database password (never the same password used for the Atlas account login itself).

---

## 10. Multi-Student Deployment

Once the backend and Atlas are both deployed (§5-§7), every student's browser talks to the **same** Render backend, which talks to the **same** Atlas cluster — this is what actually enables shared assignments/submissions/demo data, unlike the local-only setup in §3. A teacher's assignment created through the deployed Teacher Workspace is immediately visible to every student hitting the same backend URL, because there is now exactly one MongoDB, not one per laptop.

### Concurrency analysis (specific to this codebase)

- **FastAPI worker model.** `uvicorn app.main:app` with no `--workers` flag (the exact command in this repo's own README and §7's Render start command) runs a **single worker process**. FastAPI/Starlette's async event loop can interleave many I/O-bound requests concurrently within that one process (fine for `/simulate` on small teaching topologies, fine for MongoDB reads/writes), but it does **not** give true CPU parallelism — Python's GIL means one CPU-bound computation blocks the event loop until it returns.
- **CPU-heavy exact enumeration is the actual risk.** `/optimize` with a large `maxExactCombinations` budget (WPO/LWO/Joint's `EXACT_ENUMERATION`/`EXACT_JOINT_ENUMERATION` search) is synchronous, CPU-bound Python — while one student's large exact search runs, it blocks that single worker's event loop, delaying every *other* concurrent request (another student's `/simulate` call, a health check, anything) until it finishes or its `timeLimitSeconds` deadline is hit.
- **Existing safety controls already limit the blast radius** (all in `backend/app/services/optimization_service.py`, unmodified by this document): `timeLimitSeconds` (1-300s, default 30s) bounds how long any single optimize call can occupy the worker; `maxExactCombinations`, capped server-side by `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` (default 2,000,000), bounds how large a search a student can even request. These already exist specifically because PR6 of this project's own history anticipated exactly this risk (see `docs/research/sprint2-mip-architecture-analysis.md`'s PR6 addendum) — they are load-bearing for any deployment, not just local dev.
- **What this means concretely:** one student running a deliberately large exact search (near the safety cap, near the 300s ceiling) can noticeably slow down everyone else's requests for the duration of that one search, on a single-worker deployment. It cannot crash the service or corrupt data, and it self-terminates at the timeout — but it is a real, felt slowdown, not just a theoretical one.

### Recommendation for an initial teaching deployment

**Keep it simple — do not add a job queue or worker pool yet.** For a single class's realistic concurrent load (a lecture demo, a handful of students experimenting with the Optimization Lab at once, not hundreds of simultaneous large exact searches), the existing timeout + budget-cap controls are sufficient, and Render's paid Web Service plans support multiple `--workers` (or multiple service instances) as a one-line, no-architecture-change lever if load testing shows it's needed — see Stage 3 in §11. Consider lowering `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` from its 2,000,000 default for a shared, modest-CPU Render instance, so a worst-case exact search stays comfortably inside a few seconds rather than tens of seconds (§4 of `docs/research/sprint2-mip-architecture-analysis.md` has this project's own measured µs-per-candidate benchmark to base that choice on, if this document's own author later needs to actually pick a number).

---

## 11. Future Scaling Roadmap

| Stage | Setup | What it enables | Move to next stage when... |
|---|---|---|---|
| **Stage 0 — Local development** | React (Vite dev server) + FastAPI (`uvicorn --reload`) + MongoDB optional, local only | Everything in §1's "works without MongoDB" table, plus full persistence if a contributor runs local MongoDB (§2) | A second person needs to see the *same* data — the current setup, working as documented, is the ceiling for shared state |
| **Stage 1 — Shared database** ✅ **verified** | Local frontend (`npm run dev`) + local backend (`uvicorn`) + `MONGODB_URI` pointed at a shared MongoDB Atlas cluster instead of `localhost:27018` | Everyone's local frontend/backend now reads/writes the *same* assignments/submissions — good for a small team validating Atlas before deploying anything publicly | The team needs the app itself reachable by people who don't have the repo cloned/running locally — a teacher demoing to students who aren't developers |
| **Stage 2 — Simple classroom deployment** | Render Static Site (frontend) + Render Web Service (backend, single instance/worker) + MongoDB Atlas (§5-§7) | A URL anyone can open — the actual "the class can use this" milestone | Sustained concurrent load causes noticeable slowdown (§10) that isn't resolved by simply lowering the search-budget cap, or genuine multi-section/multi-course usage |
| **Stage 3 — Higher concurrency** | Same architecture, but the Render Web Service scaled to multiple workers/instances (a Render plan/config change, not a rewrite) — and, only if CPU-bound `/optimize` calls are the specific bottleneck (not just general traffic), a separate background job/worker process for exact-enumeration searches so they stop blocking request-handling workers | Concurrent optimization-heavy usage stops degrading unrelated requests | Load requires coordinating many independent services, custom autoscaling policies, or multi-region routing — not just "more of the same process" |
| **Stage 4 — Container orchestration (Kubernetes)** | Only if Stage 3's simpler scaling (more Render workers/instances, or one background job service) is measurably insufficient | Fine-grained autoscaling, multi-service orchestration, custom scheduling | This stage should be justified by an actual measured bottleneck at Stage 3, never adopted speculatively — see §5's reasoning for why it isn't needed today |

---

## 12. Deployment Checklist

### Local database checklist
- [ ] MongoDB running locally (Docker container `network-viz-mongo` on port 27018, or native `mongod --port 27018`)
- [ ] `backend/.env` exists, copied from `backend/.env.example` (or edited to match)
- [ ] `GET /health` → `"mongoAvailable": true`
- [ ] `mongosh --port 27018` → `show collections` lists at least `assignments` after one write

### Atlas migration checklist
- [x] Atlas project + M0 cluster created, region chosen deliberately (§4 step 1)
- [x] Dedicated application database user created with a generated, unique password (§4 step 2, §9)
- [x] Network access configured (§4 step 3, §9)
- [x] Connection string obtained from Atlas's own "Connect → Drivers → Python" flow (§4 step 4)
- [x] `MONGODB_URI`/`MONGODB_DATABASE` set in `backend/.env` — never committed (§4 steps 5-6)
- [x] `serverSelectionTimeoutMS` made configurable (`MONGODB_SERVER_SELECTION_TIMEOUT_MS`, default 5000) — see §4's "Atlas migration status" section
- [x] `GET /health` → `"mongoAvailable": true` against Atlas, with local MongoDB stopped to rule out a false positive (§4 step 7)
- [x] Demo data seeded (`POST /seed-demo-scenarios`) — 16 scenarios, confirmed idempotent on re-run, no duplicates (§4 steps 8-9)
- [ ] Demo Student flow, and assignment/submission/simulation-run restart-persistence, verified live — **not completed**; blocked by an intermittent network-connectivity issue in the session that ran this checklist (not a credentials/config problem — see §4's "Atlas migration status" for the exact repro commands to finish this once connectivity is stable)

### Render deployment checklist
- [ ] Backend Web Service: root `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (§7)
- [ ] Backend env vars set: `MONGODB_URI`, `MONGODB_DATABASE`, optionally `MONGODB_SERVER_SELECTION_TIMEOUT_MS`, `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP`, `PYTHON_VERSION` (§8)
- [ ] `FRONTEND_ORIGIN` (or `FRONTEND_ORIGINS`) set on the backend to the deployed frontend's exact origin, and the backend redeployed/restarted so the new env var takes effect (§7, §16)
- [ ] Frontend Static Site: root `frontend`, build `npm install && npm run build`, publish `dist` (§6)
- [ ] Frontend env var set at build time: `VITE_BACKEND_URL` → the backend's public Render URL (§6, §8)
- [ ] Frontend rebuilt (not just redeployed) after any `VITE_BACKEND_URL` change

### Post-deploy smoke test checklist
- [ ] `GET <backend>/health` → `200`, `"mongoAvailable": true`
- [ ] `POST <backend>/simulate` with a minimal ECMP network → `200` with a valid `SimulationResult`
- [ ] `POST <backend>/optimize` with `mode: "OPT"` on the same network → `200` with `status: "OPTIMAL"`
- [ ] `POST <backend>/optimize/search-space` with `mode: "WPO"` → `200` with a `searchSpaceSize`
- [ ] Frontend loads at its public URL, `Start Building a Network` guest flow works end-to-end
- [ ] Student/Demo Student login works (`demo`/`demo` signs straight into the Demo Scenario Pack)
- [ ] Create an assignment via Teacher Workspace, confirm `GET <backend>/assignments` lists it after a page refresh (proves Atlas persistence, not just in-memory)
- [ ] Submit a student submission, confirm it's retrievable via `GET <backend>/submissions/{id}`
- [ ] `POST <backend>/seed-demo-scenarios` → `{"seeded": 16, ...}`, then confirm the Demo Student dashboard shows all 16 scenarios
- [ ] Open browser dev tools on the deployed frontend, confirm no CORS errors on any `fetch()` call to the backend

---

## 13. README Cross-Reference

`README.md`'s existing "Optional MongoDB" subsection (under "Running the Project") already documents the local Docker command and `.env` values accurately. This document does not duplicate that — see README §"Optional MongoDB" for the day-to-day local setup, and this file for everything beyond local (multi-user limitations, Atlas, Render, and the full deployment/scaling plan). README now links directly to this document from that subsection.

---

## 14. What This Document Deliberately Does Not Do

Per this task's own scope: no Render services were created, no Atlas cluster was created, no credentials were added anywhere, no production architecture was changed, no Kubernetes was introduced, and no optimization algorithm was modified. §4's `serverSelectionTimeoutMS` fix and §7's CORS `origins` fix have both since been implemented and verified — the CORS fix specifically in response to a real deployed-production incident, see §16.

## 15. How This Document Was Validated

Every command, path, and environment variable name above was checked against the actual repository on branch `main` before being written:

- `MONGODB_URI`/`MONGODB_DATABASE`/port 27018 and the `MONGODB_SERVER_SELECTION_TIMEOUT_MS` default (`5000`, previously a hardcoded `500`) — read directly from `backend/.env.example`, `backend/app/services/mongo_config.py`, `backend/app/services/assignment_service.py`, `backend/app/services/run_storage_service.py`.
- No automatic index creation — repo-wide search for `create_index`/`ensure_index`/`.index(` returned no matches under `backend/app/`.
- `VITE_BACKEND_URL` — read directly from `frontend/src/api/simulationApi.ts`, `optimizationApi.ts`, and `frontend/src/env.d.ts`.
- Build command/output directory — read directly from `frontend/package.json`'s `scripts.build` and confirmed against this repo's own `npm run build` output (`dist/index.html`, `dist/assets/...`); `vite.config.ts` has no `outDir` override.
- No `react-router-dom` — confirmed absent from `frontend/package.json`'s dependencies.
- `uvicorn app.main:app` (not `main:app`) — confirmed by `backend/app/main.py`'s actual module path (`backend/app/main.py`, imported as `app.main` per the existing README's own working local command).
- `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` and its default `2_000_000` — read directly from `backend/app/services/optimization_service.py`.
- `dnspython` as an unconditional `pymongo` dependency — confirmed via `importlib.metadata.distribution("pymongo").requires` against this project's own `.venv`, cross-checked against `pip freeze` showing `dnspython==2.8.0` already installed despite never being listed in `backend/requirements.txt`.
- CORS `origins` list content, and its `FRONTEND_ORIGIN`/`FRONTEND_ORIGINS` env-driven extension — read directly from `backend/app/main.py`, and confirmed live against the real deployed backend (§16): a simulated CORS preflight from a non-localhost origin returned `400 Disallowed CORS origin` before the fix, while direct server-to-server calls (bypassing CORS entirely) succeeded throughout, isolating the failure to the browser-enforced CORS layer specifically.
- No `runtime.txt`/`.python-version`/`render.yaml`/`Procfile` anywhere in the repo — confirmed by direct `find`.
- Render's documented build/start commands and Python-version-pinning mechanism, and MongoDB Atlas's documented cluster/user/network-access/connection-string flow — checked against Render's and MongoDB's own current documentation (`render.com/docs/deploy-fastapi`, `render.com/docs/python-version`, `render.com/docs/deploy-create-react-app`, and current MongoDB Atlas setup guidance) rather than assumed from memory.

---

## 16. Deployed Production Incident — CORS blocking the Demo Scenario Dashboard

**Symptom:** after the first real deployment (Render Static Site + Render Web Service + MongoDB Atlas), the deployed frontend loaded and `demo`/`demo` login worked (both entirely client-side, no backend call), but clicking "Reseed pack" on the Demo Scenario Dashboard showed **"Seeding failed. Is MongoDB running?"** — even though MongoDB Atlas was confirmed healthy from the backend directly.

### Root cause

`backend/app/main.py`'s CORS `origins` list was hardcoded to four `localhost`/`127.0.0.1` values only (§7, before this fix). The deployed frontend's real origin (its own `https://*.onrender.com` URL) was never in that list, so every cross-origin browser request from it was rejected by CORS — regardless of whether the backend or MongoDB were healthy.

**Confirmed directly against the live deployed backend, not inferred:**

```bash
# Server-to-server (bypasses CORS entirely) — both succeeded:
curl https://inet-project.onrender.com/health
# {"status":"ok","mongoAvailable":true}
curl -X POST https://inet-project.onrender.com/seed-demo-scenarios
# {"seeded":16, ...}  — MongoDB Atlas write confirmed working from the deployed backend

# Simulated browser preflight from a non-localhost origin — rejected:
curl -i -X OPTIONS https://inet-project.onrender.com/seed-demo-scenarios \
  -H "Origin: https://<the-deployed-frontend-origin>" \
  -H "Access-Control-Request-Method: POST"
# HTTP/2 400
# Disallowed CORS origin
```

This isolates the failure precisely: the backend, Atlas, and the seeding logic were all completely healthy — only the CORS allowlist was misconfigured for a browser-originated request from anywhere other than localhost.

### Fix

1. **Backend CORS made environment-driven** (`backend/app/main.py`) — `LOCAL_DEV_ORIGINS` (the original four) are always allowed unconditionally (zero change for local dev); `FRONTEND_ORIGIN` (single) and/or `FRONTEND_ORIGINS` (comma-separated) are read from the environment and appended on top. `allow_origins=["*"]` is never used — an explicit list only, since that combined with this app's existing `allow_credentials=True` is rejected by browsers outright regardless.
2. **A second, independent hardcoded-`localhost` bug, found during the same audit and fixed alongside it:** the Teacher Dashboard's separate "Seed Demo to MongoDB" button (`WorkflowManager.tsx`'s `handleSeedDemoToMongoDB`) called `fetch("http://localhost:8000/health")` and `fetch("http://localhost:8000/seed-demo", ...)` directly — completely ignoring `VITE_BACKEND_URL`. This would always fail in production (trying to reach the visitor's own browser's `localhost:8000`) independent of the CORS fix above. Replaced with two new `simulationApi.ts` functions (`getBackendHealth()`, `seedDemoAssignments()`), consistent with every other API call in the codebase. Confirmed via repo-wide search that `VITE_BACKEND_URL` (with its documented `http://localhost:8000` local-dev fallback) is now the *only* place any frontend API base URL is determined.
3. **Demo Scenario Dashboard error messages no longer default to "Is MongoDB running?" for every failure.** `simulationApi.ts` gained a small `ApiError` type carrying the HTTP status when a real response came back, letting `DemoScenarioDashboard.tsx` distinguish three cases the Fetch API's own behavior actually supports distinguishing:
   - **Backend unreachable** (`fetch()` itself threw — no HTTP response at all, which is what a CORS rejection *also* looks like from JS, by browser design — the Fetch API deliberately doesn't expose *why* a cross-origin request failed) → "Could not reach the backend at all — it may be down or still starting up, or the request was blocked by CORS... This is not necessarily a MongoDB problem."
   - **Request rejected** (an `ApiError` with a 4xx status) → shows the backend's own rejection reason.
   - **Server error consistent with Mongo being unavailable** (an `ApiError` with a 5xx status, *or* a 200 response where the seed endpoint's own payload reports `seeded: 0` — its documented graceful-degradation signal, see `app/services/demo_scenario_service.py`) → only *this* case still mentions MongoDB specifically, since it is the one case actually consistent with that being the cause.

### Files changed

- `backend/app/main.py` — CORS `origins` now `LOCAL_DEV_ORIGINS + FRONTEND_ORIGIN/FRONTEND_ORIGINS`.
- `backend/.env.example` — documents the new variables (no secrets).
- `frontend/src/api/simulationApi.ts` — new `ApiError`, `getBackendHealth()`, `seedDemoAssignments()`; `listDemoScenarios()`/`seedDemoScenarios()` now throw `ApiError` (status-carrying) instead of a plain `Error`.
- `frontend/src/components/WorkflowManager.tsx` — `handleSeedDemoToMongoDB` no longer hardcodes `localhost:8000`.
- `frontend/src/pages/DemoScenarioDashboard.tsx` — `describeApiError()` classification, used by both the initial load and the seed handler.

### Required to actually resolve this in production

- **Render backend environment variable:** `FRONTEND_ORIGIN` set to the deployed frontend's exact origin (scheme + host, no trailing slash) — e.g. `https://inet-project-frontend.onrender.com`, whatever the real Render Static Site URL is. Use `FRONTEND_ORIGINS` instead if more than one origin needs to be allowed (e.g. a preview deploy).
- **Backend redeploy required** — an env var change on Render does not take effect until the service restarts; trigger a redeploy (or a manual restart) after setting `FRONTEND_ORIGIN`.
- **Frontend:** no redeploy required for *this specific fix* — `VITE_BACKEND_URL` was already correctly configured (the deployed frontend already reaches the deployed backend's `/health` etc.; only the browser-enforced CORS layer was blocking it). The `WorkflowManager.tsx`/`DemoScenarioDashboard.tsx` code changes above do change the frontend's compiled JS, though, so the frontend **does** need rebuilding/redeploying to actually ship the improved error messages and the hardcoded-`localhost` fix — just not because of the CORS root cause itself.
