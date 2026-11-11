# DisasterDispatch 🚨

A real-time disaster-response coordination platform. When a wildfire or disaster is detected, the system automatically alerts registered residents by SMS, manages a priority transport queue, dispatches nearby drivers, and displays a live public heatmap showing exactly who has been helped, who is waiting, and who still needs assistance.

---

## How It Works

```
Disaster detected (NASA FIRMS or admin)
        │
        ▼
Risk assessment per resident (PostGIS proximity)
        │
        ├── Approaching zone ──► Advisory SMS + transport offer
        └── Imminent zone ────► Evacuate NOW SMS + priority queue
                │
                ▼
        Resident replies YES
                │
                ▼
        Added to priority transport queue
        (imminent = higher priority)
                │
                ▼
        Nearest available driver dispatched via SMS
                │
                ▼
        Driver replies ACCEPT / DECLINE
                │
                ▼
        Live heatmap updates for everyone
```

---

## Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js + TypeScript + Fastify |
| Database | PostgreSQL + PostGIS |
| SMS | Mock service (dev) → Twilio-ready interface |
| Disaster data | NASA FIRMS API + admin manual override |
| Frontend | React + TypeScript + Vite |
| Maps | Leaflet + OpenStreetMap |
| Live updates | Server-Sent Events (SSE) |

Everything runs locally. No cloud accounts or paid services required to develop.

---

## Project Status

Track progress in [`PLAN.md`](./PLAN.md) — this is the single source of truth for what is done, in progress, and pending. Each sub-task has a checkbox status that is updated as work completes.

| # | Sub-Task | Status |
|---|---|---|
| 1 | Project Scaffold & Monorepo Structure | ⬜ pending |
| 2 | Database Schema & Migrations | ⬜ pending |
| 3 | Core API: Resident & Driver Registration | ⬜ pending |
| 4 | Disaster Zone Ingestion (NASA FIRMS + Admin Override) | ⬜ pending |
| 5 | Alert Engine (Risk Assessment & SMS Dispatch) | ⬜ pending |
| 6 | Transport Queue & Driver Dispatch Engine | ⬜ pending |
| 7 | Heatmap API & Server-Sent Events | ⬜ pending |
| 8 | Frontend: Public Heatmap & Registration Pages | ⬜ pending |
| 9 | Admin SMS Simulation UI | ⬜ pending |

> Update this table and the checkboxes in `PLAN.md` as sub-tasks are completed.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for the PostGIS database)
- [NASA FIRMS API key](https://firms.modaps.eosdis.nasa.gov/api/area/) (free)

---

## Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/your-org/disasterdispatch.git
cd disasterdispatch

# 2. Copy environment variables
cp .env.example .env
# Fill in NASA_FIRMS_API_KEY, FIRMS_BOUNDING_BOX, and ADMIN_API_KEY

# 3. Start the database
docker compose up -d

# 4. Install dependencies
npm install

# 5. Run migrations and seed data
npm run migrate
npm run seed

# 6. Start the full dev server (API + frontend)
npm run dev
```

- API: http://localhost:3000
- Frontend (heatmap): http://localhost:5173
- SMS simulator (dev tool): http://localhost:5173/admin/simulate

---

## Continuing Development with an AI

This project is designed to be continued with an AI assistant (e.g. Bob in Agent mode). To pick up where the last session left off:

1. Open this repo in your editor.
2. Switch to **Agent mode**.
3. Tell your AI:

   > "Read PLAN.md. Find the first sub-task that is still marked `[ ] pending` and implement it. After completing it, mark it as `[x] done` in PLAN.md."

The `PLAN.md` file contains full intent, expected outcomes, specific todos, and all relevant technical context for every sub-task. Each sub-task is designed to be self-contained — one AI session, one sub-task.

---

## Repository Structure

```
disasterdispatch/
├── packages/
│   ├── api/                  # Fastify backend
│   │   └── src/
│   │       ├── routes/       # HTTP route handlers
│   │       ├── services/     # Alert engine, dispatch, SMS, SSE
│   │       ├── db.ts         # PostgreSQL pool
│   │       ├── app.ts        # Fastify app setup
│   │       └── server.ts     # Entry point
│   └── web/                  # React frontend
│       └── src/
│           ├── pages/        # Heatmap, registration, admin simulate
│           └── hooks/        # useHeatmapStream SSE hook
├── docker-compose.yml        # Local PostgreSQL + PostGIS
├── .env.example              # All required env vars documented
├── PLAN.md                   # Full project plan and task tracker
└── README.md
```

---

## Environment Variables

See [`.env.example`](./.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NASA_FIRMS_API_KEY` | Free key from the FIRMS portal |
| `FIRMS_BOUNDING_BOX` | Geographic area to monitor (`minLon,minLat,maxLon,maxLat`) |
| `ADMIN_API_KEY` | Key to access admin endpoints |
| `APPROACHING_RADIUS_M` | Distance in metres for "approaching" alerts (default: 10000) |
| `IMMINENT_RADIUS_M` | Distance in metres for "imminent" alerts (default: 2000) |

---

## Contributing

1. Check [`PLAN.md`](./PLAN.md) for the next pending sub-task.
2. Create a branch named `subtask/N-short-description` (e.g. `subtask/1-scaffold`).
3. Implement the sub-task following its intent, expected outcomes, and todo list exactly.
4. Mark the sub-task `[x] done` in `PLAN.md` when complete.
5. Open a PR — reference the matching GitHub Issue if one exists.
