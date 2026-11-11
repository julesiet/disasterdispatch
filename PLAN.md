# Disaster Alert & Evacuation Coordination Platform — Plan

## Top-Level Overview

A local-first, full-stack disaster-response coordination platform. When a wildfire or disaster is detected (via NASA FIRMS API or manual admin override), the system:

1. Determines the risk level of every registered resident based on proximity to the danger zone.
2. Sends tiered SMS alerts (mock service, Twilio-ready): *approaching* zone gets an advisory with a transport request option; *imminent* zone gets a short evacuate-immediately message and is auto-prioritised in the queue.
3. Manages a transport request queue (PostgreSQL priority queue) and dispatches registered drivers via SMS.
4. Serves a live public-facing heatmap showing danger zones and per-grid-cell resident status (helped / waiting / at risk) updated via Server-Sent Events (SSE).

**Scope:** Local development only. No cloud hosting, no Redis, no paid services.

**Stack:**
- Backend: Node.js + TypeScript + Fastify
- Database: PostgreSQL + PostGIS
- SMS: Mock service (console + DB log), Twilio-ready interface
- Disaster data: NASA FIRMS API + admin manual override
- Frontend: React + TypeScript + Vite
- Maps: Leaflet + OpenStreetMap
- Live updates: Server-Sent Events (SSE) via Fastify

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold & Monorepo Structure

**Status:** [x] done

**Intent:**
Set up the repository structure, tooling, and base configuration for both the backend and frontend. This establishes the foundation every other sub-task builds on.

**Expected Outcomes:**
- A monorepo with `packages/api` (Fastify + TypeScript) and `packages/web` (React + Vite + TypeScript).
- TypeScript configured with strict mode in both packages.
- ESLint + Prettier configured at the root.
- A root `package.json` with workspace scripts to run both packages concurrently (`dev`, `build`).
- A `docker-compose.yml` at the root for local PostgreSQL + PostGIS (single dependency).
- A `.env.example` documenting all required environment variables.

**Todo List:**
- [ ] Initialise root `package.json` with npm workspaces pointing at `packages/api` and `packages/web`.
- [ ] Scaffold `packages/api`: init package, install Fastify, TypeScript, `ts-node-dev`, `@types/node`.
- [ ] Scaffold `packages/web`: create with `npm create vite` using React + TypeScript template.
- [ ] Add root `tsconfig.base.json` with strict settings; extend from each package.
- [ ] Add ESLint + Prettier config at root, shared across both packages.
- [ ] Create `docker-compose.yml` with a `postgis/postgis:16-3.4` service, named volume, and exposed port 5432.
- [ ] Create `.env.example` listing: `DATABASE_URL`, `NASA_FIRMS_API_KEY`, `PORT`, `CORS_ORIGIN`.
- [ ] Add root `dev` script using `concurrently` to start both `packages/api` and `packages/web`.

**Relevant Context:**
- No existing codebase — greenfield scaffold.
- PostGIS Docker image: `postgis/postgis:16-3.4`.
- NASA FIRMS API key is free at https://firms.modaps.eosdis.nasa.gov/api/area/.

---

### Sub-Task 2 — Database Schema & Migrations

**Status:** [x] done

**Intent:**
Define and apply the full PostgreSQL + PostGIS schema. All geospatial logic (distance queries, grid cell aggregation) depends on this being correct from the start.

**Expected Outcomes:**
- A migration tool (e.g. `node-pg-migrate` or plain SQL files run via a `migrate` npm script) is in place.
- All tables exist with correct columns, constraints, and PostGIS geometry columns.
- A seed script populates a handful of test residents and drivers for local development.

**Todo List:**
- [ ] Install `pg`, `node-pg-migrate` (or equivalent) in `packages/api`.
- [ ] Create migration: `residents` table — `id`, `name`, `phone`, `location GEOGRAPHY(POINT, 4326)`, `created_at`.
- [ ] Create migration: `drivers` table — `id`, `name`, `phone`, `service_area GEOGRAPHY(POINT, 4326)`, `available BOOLEAN`, `created_at`.
- [ ] Create migration: `danger_zones` table — `id`, `source` (firms | admin), `zone GEOGRAPHY(POLYGON, 4326)`, `severity` (approaching | imminent), `active BOOLEAN`, `created_at`, `updated_at`.
- [ ] Create migration: `alerts` table — `id`, `resident_id`, `danger_zone_id`, `tier` (approaching | imminent), `sent_at`, `responded_at`, `response` (requested_transport | acknowledged | null).
- [ ] Create migration: `transport_requests` table — `id`, `resident_id`, `tier` (approaching | imminent), `status` (waiting | assigned | completed | cancelled), `priority INT` (1 = imminent, 2 = approaching), `driver_id` (nullable FK), `created_at`, `updated_at`.
- [ ] Create migration: `sms_log` table — `id`, `to_phone`, `body`, `direction` (outbound | inbound), `metadata JSONB`, `created_at`.
- [ ] Create migration: `driver_dispatches` table — `id`, `driver_id`, `transport_request_id`, `status` (pending | accepted | declined | completed), `created_at`, `updated_at`.
- [ ] Write a seed script (`seed.ts`) with ~10 residents and ~5 drivers spread across a sample geographic area.

**Relevant Context:**
- PostGIS `GEOGRAPHY` type handles distance calculations in metres natively — use `ST_DWithin` for proximity checks.
- `priority` column on `transport_requests`: `1` = imminent zone (higher priority), `2` = approaching zone.
- All geospatial input will arrive as `{ lat, lng }` — store as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)`.

---

### Sub-Task 3 — Core API: Resident & Driver Registration

**Status:** [x] done

**Intent:**
Build the REST endpoints for residents and drivers to register themselves. This is the entry point for all user data the alert and dispatch engines depend on.

**Expected Outcomes:**
- `POST /residents` — registers a resident with name, phone, lat/lng.
- `POST /drivers` — registers a driver with name, phone, lat/lng.
- `GET /residents/:id` and `GET /drivers/:id` for lookups.
- Input validated with Fastify's JSON schema validation.
- A shared database client module (`packages/api/src/db.ts`) used by all routes.

**Todo List:**
- [ ] Create `packages/api/src/db.ts` — exports a `pg.Pool` instance configured from `DATABASE_URL`.
- [ ] Create `packages/api/src/routes/residents.ts` — `POST /residents`, `GET /residents/:id`.
- [ ] Create `packages/api/src/routes/drivers.ts` — `POST /drivers`, `GET /drivers/:id`, `PATCH /drivers/:id/availability`.
- [ ] Register routes in `packages/api/src/app.ts` under `/api/v1`.
- [ ] Add Fastify JSON schema validation for all request bodies (name string, phone string E.164, lat number -90..90, lng number -180..180).
- [ ] Return `409 Conflict` if a phone number is already registered.

**Relevant Context:**
- Fastify schema validation rejects invalid input before it hits route handlers — define schemas inline or in a `schemas/` folder.
- E.164 phone format: `^\+[1-9]\d{1,14}$`.

---

### Sub-Task 4 — Disaster Zone Ingestion (NASA FIRMS + Admin Override)

**Status:** [x] done

**Intent:**
Pull live wildfire perimeter/hotspot data from NASA FIRMS and write it into `danger_zones`. Provide an admin endpoint to manually create or modify zones. This is the trigger source for all downstream alerting.

**Expected Outcomes:**
- A background poller runs every 10 minutes, fetches NASA FIRMS active fire data for a configured bounding box, and upserts records into `danger_zones`.
- `POST /admin/danger-zones` allows an admin to manually create a zone (polygon + severity).
- `PATCH /admin/danger-zones/:id` allows severity or geometry updates.
- `DELETE /admin/danger-zones/:id` marks a zone inactive.
- Zones are classified as `imminent` or `approaching` based on fire radiative power (FRP) from FIRMS data, or set explicitly by admin.

**Todo List:**
- [ ] Create `packages/api/src/services/firms-sync.ts` — fetches NASA FIRMS CSV/GeoJSON for a configured bounding box, parses active fire hotspots into polygons (buffered points if no polygon available), upserts into `danger_zones`.
- [ ] Register a Fastify `onReady` hook or `setInterval` to run `firms-sync` every 10 minutes.
- [ ] Create `packages/api/src/routes/admin/danger-zones.ts` — `POST`, `PATCH :id`, `DELETE :id`.
- [ ] Add a simple API key check middleware for admin routes (key read from `ADMIN_API_KEY` env var).
- [ ] After each sync or admin change, emit an internal event (`EventEmitter`) for the alert engine to process new/changed zones.
- [ ] Add `FIRMS_BOUNDING_BOX` and `ADMIN_API_KEY` to `.env.example`.

**Relevant Context:**
- NASA FIRMS Area API endpoint: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{API_KEY}/VIIRS_SNPP_NRT/{bbox}/{days}`.
- FIRMS returns CSV rows with lat, lon, FRP (fire radiative power), confidence. Buffer each point by e.g. 500m to create a polygon: `ST_Buffer(point::geography, 500)`.
- FRP threshold for `imminent` vs `approaching` can start at a configurable env var `FIRMS_IMMINENT_FRP_THRESHOLD` (default: 50).

---

### Sub-Task 5 — Alert Engine (Risk Assessment & SMS Dispatch)

**Status:** [ ] pending

**Intent:**
When danger zones change, determine which residents are at risk, at what tier, and send them the appropriate SMS. Track that alerts have been sent to avoid duplicates. Handle inbound SMS replies (mock webhook) to capture transport requests.

**Expected Outcomes:**
- When a zone event fires, the engine queries residents within the zone's radius using PostGIS `ST_DWithin`.
- Residents in `imminent` zones get the short evacuate-immediately message; `approaching` zone residents get the advisory + transport offer.
- Each alert is recorded in the `alerts` table; residents who already have a sent alert for this zone are skipped.
- An inbound reply handler processes "YES" replies and creates a `transport_requests` record with correct priority.
- The mock SMS service logs all messages to console and `sms_log` table.

**Todo List:**
- [ ] Create `packages/api/src/services/sms.ts` — defines an `SmsService` interface with `send(to: string, body: string): Promise<void>` and a `MockSmsService` implementation that logs to console and inserts into `sms_log`.
- [ ] Create `packages/api/src/services/alert-engine.ts` — subscribes to zone-change events, runs the PostGIS proximity query, sends tiered messages, writes to `alerts`.
- [ ] Define message templates: approaching message includes resident name, zone name, distance, and a reply prompt ("Reply YES for transport"); imminent message is short: "EVACUATE NOW. Reply YES for priority transport."
- [ ] Create `packages/api/src/routes/sms-webhook.ts` — `POST /webhooks/sms-inbound` accepts `{ from, body }`, looks up the resident by phone, finds their latest unanswered alert, creates a `transport_requests` record with `priority = 1` if their tier is imminent, else `priority = 2`.
- [ ] Prevent duplicate alerts: before sending, check `alerts` table for existing record with same `resident_id` + `danger_zone_id`.
- [ ] Export a `SmsServiceToken` symbol and register `MockSmsService` via Fastify's DI (`fastify.decorate`) so it can be swapped for a real Twilio service later.

**Relevant Context:**
- Proximity radii (configurable env vars): `APPROACHING_RADIUS_M` (default 10000m / 10km), `IMMINENT_RADIUS_M` (default 2000m / 2km).
- The inbound webhook simulates Twilio's webhook — same shape, so dropping in real Twilio later requires only pointing Twilio's webhook URL at this endpoint.
- PostGIS query pattern: `SELECT id FROM residents WHERE ST_DWithin(location, $zoneGeom, $radiusMetres)`.

---

### Sub-Task 6 — Transport Queue & Driver Dispatch Engine

**Status:** [ ] pending

**Intent:**
Manage the priority queue of residents requesting transport and dispatch available drivers to the highest-priority residents first.

**Expected Outcomes:**
- `GET /admin/transport-queue` returns residents ordered by priority then created_at.
- When a new transport request is created, the dispatch engine immediately tries to assign the nearest available driver.
- Assigned driver receives an SMS with the resident's name, address/coordinates, and a reply prompt ("Reply ACCEPT or DECLINE").
- Driver reply webhook updates the dispatch record and, on DECLINE, re-queues the request and tries the next driver.
- `PATCH /admin/transport-requests/:id/complete` marks a request as completed and frees the driver.

**Todo List:**
- [ ] Create `packages/api/src/services/dispatch-engine.ts` — listens for new `transport_requests`, queries for the nearest available driver using `ST_Distance`, assigns them, sends dispatch SMS.
- [ ] Create `packages/api/src/routes/sms-webhook.ts` extension — handle driver ACCEPT/DECLINE replies by phone number lookup against `driver_dispatches`.
- [ ] `POST /admin/transport-queue` query: `SELECT tr.*, r.name, r.location FROM transport_requests tr JOIN residents r ON tr.resident_id = r.id WHERE tr.status = 'waiting' ORDER BY tr.priority ASC, tr.created_at ASC`.
- [ ] On ACCEPT: set `driver_dispatches.status = accepted`, `transport_requests.status = assigned`, `drivers.available = false`.
- [ ] On DECLINE: set `driver_dispatches.status = declined`, find next nearest available driver, send new dispatch SMS.
- [ ] On complete: set `transport_requests.status = completed`, `drivers.available = true`, emit SSE event to update heatmap.

**Relevant Context:**
- Driver distance query: `SELECT id FROM drivers WHERE available = true ORDER BY ST_Distance(service_area, $residentLocation) ASC LIMIT 1`.
- Imminent-zone residents (`priority = 1`) must always be dequeued before approaching-zone residents (`priority = 2`), regardless of arrival time.
- The same `sms-webhook` route handles both resident and driver replies — distinguish by checking if the `from` phone belongs to a driver or resident.

---

### Sub-Task 7 — Heatmap API & Server-Sent Events

**Status:** [ ] pending

**Intent:**
Provide the frontend with a live data feed of danger zones and per-grid-cell resident status. Use SSE so the map updates in real time without polling.

**Expected Outcomes:**
- `GET /api/v1/heatmap/zones` returns all active danger zones as GeoJSON.
- `GET /api/v1/heatmap/grid` returns a GeoJSON FeatureCollection where each feature is a grid cell with properties: `helped` (completed transports), `waiting` (assigned or waiting requests), `at_risk` (residents with active imminent/approaching alerts and no transport request).
- `GET /api/v1/heatmap/stream` is an SSE endpoint; whenever a zone, alert, or transport status changes, it pushes an updated heatmap snapshot to all connected clients.
- Grid cell size is configurable via `HEATMAP_GRID_DEGREES` env var (default: 0.01 degrees ≈ 1km).

**Todo List:**
- [ ] Create `packages/api/src/routes/heatmap.ts` with the three endpoints above.
- [ ] Implement grid cell aggregation query using `ST_SnapToGrid` on resident locations, grouped by grid cell.
- [ ] Create `packages/api/src/services/sse-broadcaster.ts` — maintains a `Set` of active SSE response objects; exposes a `broadcast(event, data)` method.
- [ ] Call `sseBroadcaster.broadcast('heatmap-update', payload)` from: alert engine (on alert sent), dispatch engine (on status change), and firms-sync (on zone update).
- [ ] Implement SSE keep-alive ping every 30 seconds to prevent connection timeouts.
- [ ] Add `HEATMAP_GRID_DEGREES` to `.env.example`.

**Relevant Context:**
- SSE response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Fastify SSE: use `reply.raw` to write directly to the underlying Node.js response stream.
- Grid query pattern: `SELECT ST_SnapToGrid(location::geometry, $gridDeg) AS cell, COUNT(*) FROM residents GROUP BY cell`.

---

### Sub-Task 8 — Frontend: Public Heatmap & Registration Pages

**Status:** [ ] pending

**Intent:**
Build the React frontend: a public-facing live heatmap, a resident registration form, and a driver registration form.

**Expected Outcomes:**
- `/` — live heatmap page: Leaflet map showing danger zone polygons (red = imminent, orange = approaching) and a choropleth grid overlay coloured by risk density. Clicking a grid cell shows a popup with helped/waiting/at-risk counts.
- `/register/resident` — form to register a resident (name, phone, address with geocoding OR lat/lng input).
- `/register/driver` — form to register a driver (name, phone, current location).
- Heatmap auto-updates via SSE connection to `/api/v1/heatmap/stream`.
- Responsive layout, mobile-friendly (residents are likely on phones).

**Todo List:**
- [ ] Install `leaflet`, `react-leaflet`, `@types/leaflet` in `packages/web`.
- [ ] Create `src/pages/HeatmapPage.tsx` — initialise Leaflet map centred on configured default coordinates, add OpenStreetMap tile layer.
- [ ] Create `src/hooks/useHeatmapStream.ts` — opens an `EventSource` to the SSE endpoint and returns the latest heatmap data via React state.
- [ ] Render danger zone polygons as `Polygon` layers coloured by severity.
- [ ] Render grid cells as `Rectangle` layers with fill opacity proportional to `at_risk` count; on click show popup with stats.
- [ ] Create `src/pages/ResidentRegistrationPage.tsx` — form with name, phone (E.164), lat/lng fields; `POST /api/v1/residents` on submit.
- [ ] Create `src/pages/DriverRegistrationPage.tsx` — form with name, phone, lat/lng; `POST /api/v1/drivers` on submit.
- [ ] Set up React Router with routes `/`, `/register/resident`, `/register/driver`.
- [ ] Add a simple nav bar with links to all three pages.
- [ ] Configure Vite proxy to forward `/api` requests to the Fastify backend (avoids CORS in dev).

**Relevant Context:**
- `react-leaflet` v4+ requires Leaflet CSS to be imported manually: `import 'leaflet/dist/leaflet.css'`.
- Vite proxy config: `server.proxy: { '/api': 'http://localhost:3000' }` in `vite.config.ts`.
- SSE in React: use `useEffect` to create `new EventSource('/api/v1/heatmap/stream')` and clean up on unmount.

---

### Sub-Task 9 — Admin SMS Simulation UI

**Status:** [ ] pending

**Intent:**
Since SMS is mocked, provide a minimal admin page that lets a developer simulate inbound SMS replies (resident "YES" for transport, driver "ACCEPT"/"DECLINE") without needing a real phone. This makes the full flow testable locally.

**Expected Outcomes:**
- `/admin/simulate` page shows a list of recent outbound SMS messages from `sms_log`.
- Each message has a "Reply" button that opens a small form pre-filled with the recipient's phone number.
- Submitting the form calls `POST /webhooks/sms-inbound` with the simulated reply body.
- The heatmap and queue update in real time after a simulated reply.

**Todo List:**
- [ ] Add `GET /api/v1/admin/sms-log` endpoint returning the last 50 outbound messages ordered by `created_at DESC`.
- [ ] Create `src/pages/AdminSimulatePage.tsx` — fetches SMS log, displays messages, provides reply form.
- [ ] Add `/admin/simulate` to React Router and nav bar.
- [ ] The reply form should auto-suggest common replies (YES, ACCEPT, DECLINE) as quick-action buttons.

**Relevant Context:**
- This page is dev-only tooling — no auth needed for the scaffold.
- Ties together Sub-Tasks 5, 6, and 7 into a fully testable local loop.

---

## Architecture Reference

```
packages/
  api/
    src/
      routes/
        residents.ts
        drivers.ts
        heatmap.ts
        sms-webhook.ts
        admin/
          danger-zones.ts
          transport-queue.ts
          sms-log.ts
      services/
        alert-engine.ts
        dispatch-engine.ts
        firms-sync.ts
        sms.ts            # MockSmsService + SmsService interface
        sse-broadcaster.ts
      db.ts
      app.ts
      server.ts
  web/
    src/
      pages/
        HeatmapPage.tsx
        ResidentRegistrationPage.tsx
        DriverRegistrationPage.tsx
        AdminSimulatePage.tsx
      hooks/
        useHeatmapStream.ts
      App.tsx
      main.tsx
docker-compose.yml
.env.example
package.json          # npm workspaces root
```

## Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/disasteralert` |
| `NASA_FIRMS_API_KEY` | Free key from FIRMS portal | — |
| `FIRMS_BOUNDING_BOX` | `minLon,minLat,maxLon,maxLat` | — |
| `FIRMS_IMMINENT_FRP_THRESHOLD` | FRP value above which zone is imminent | `50` |
| `APPROACHING_RADIUS_M` | Distance in metres for approaching alert | `10000` |
| `IMMINENT_RADIUS_M` | Distance in metres for imminent alert | `2000` |
| `HEATMAP_GRID_DEGREES` | Grid cell size in degrees | `0.01` |
| `ADMIN_API_KEY` | Key for admin route access | — |
| `PORT` | API server port | `3000` |
| `CORS_ORIGIN` | Frontend origin for CORS | `http://localhost:5173` |
