# Disaster Alert & Evacuation Coordination Platform — Plan

## Top-Level Overview

A local-first, full-stack disaster-response coordination platform. When a wildfire or disaster is detected (via NASA FIRMS API or manual admin override), the system:

1. Determines the risk level of every registered resident based on proximity to the danger zone.
2. Sends tiered SMS alerts (mock service, Twilio-ready): *approaching* zone gets an advisory with a transport request option; *imminent* zone gets a short evacuate-immediately message and is auto-prioritised in the queue.
3. Manages a transport request queue (PostgreSQL priority queue) and dispatches registered drivers via SMS.
4. Serves a live map showing active danger zones and resident status (helped / waiting / at risk) updated via Server-Sent Events (SSE). Residents can check a location against nearby incidents; drivers and local developers have separate Driver View and Admin Debug tabs.

**Scope:** Local development only. No cloud hosting, no Redis, no paid services.

**Stack:**
- Backend: Node.js + TypeScript + Fastify
- Database: PostgreSQL + PostGIS
- SMS: Mock service (console + DB log), Twilio-ready interface
- Disaster data: NASA FIRMS API + admin manual override
- Frontend: React + TypeScript + Vite
- Maps: Leaflet + OpenStreetMap tiles (monochrome basemap; incident overlays retain severity colors)
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
- [x] Initialise root `package.json` with npm workspaces pointing at `packages/api` and `packages/web`.
- [x] Scaffold `packages/api` with Fastify, TypeScript, and Node's watch mode for local development.
- [x] Scaffold `packages/web` with Vite, React, and TypeScript.
- [x] Add root `tsconfig.base.json` with strict settings; extend from each package.
- [x] Add ESLint + Prettier config at root, shared across packages.
- [x] Create `docker-compose.yml` with a `postgis/postgis:16-3.4` service, named volume, and exposed port 5433 on the host.
- [x] Create `.env.example` listing database, NASA FIRMS, server, CORS, alert, driver radius, heatmap, and admin settings.
- [x] Add root `dev` script using `concurrently` to start both `packages/api` and `packages/web`.

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
- [x] Install `pg` and implement the migration runner in `packages/api/src/db/migrate.ts`.
- [x] Create the `residents` table with PostGIS location, unique phone, and creation time.
- [x] Create the `drivers` table with PostGIS service location, availability, and unique phone.
- [x] Create the `danger_zones` table with polygon geometry, source, severity, and active state.
- [x] Create the `alerts` table with resident/zone links and duplicate-alert constraint.
- [x] Create the `transport_requests` table with priority, status, and driver link.
- [x] Create the `sms_log` table for inbound/outbound message records.
- [x] Create the `driver_dispatches` table for driver assignment responses.
- [x] Write a seed script with 10 LA-area residents and 5 drivers.

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
- [x] Create `packages/api/src/db.ts` — exports a `pg.Pool` instance configured from `DATABASE_URL`.
- [x] Create resident and driver registration / lookup routes.
- [x] Add driver availability updates.
- [x] Register routes in `packages/api/src/app.ts` under `/api/v1`.
- [x] Add Fastify JSON schema validation for request bodies and coordinate ranges.
- [x] Return `409 Conflict` if a phone number is already registered.

**Relevant Context:**
- Fastify schema validation rejects invalid input before it hits route handlers — define schemas inline or in a `schemas/` folder.
- E.164 phone format: `^\+[1-9]\d{1,14}$`.

---

### Sub-Task 4 — Disaster Zone Ingestion (NASA FIRMS + Admin Override)

**Status:** [x] done

**Intent:**
Pull live wildfire perimeter/hotspot data from NASA FIRMS and write it into `danger_zones`. Provide an admin endpoint to manually create or modify zones. This is the trigger source for all downstream alerting.

**Expected Outcomes:**
- A background poller runs every 10 minutes, fetches NASA FIRMS active fire data for a configured bounding box, and creates buffered hotspot zones in `danger_zones`.
- `POST /admin/danger-zones` allows an admin to manually create a zone (polygon + severity).
- `PATCH /admin/danger-zones/:id` allows severity or active-state updates. Geometry can be supplied when creating a zone; editing an existing polygon remains a follow-up.
- `DELETE /admin/danger-zones/:id` marks a zone inactive.
- Zones are classified as `imminent` or `approaching` based on fire radiative power (FRP) from FIRMS data, or set explicitly by admin.

**Todo List:**
- [x] Create `packages/api/src/services/firms-sync.ts` to fetch FIRMS CSV and store 500m hotspot buffers.
- [x] Register the FIRMS poller on server startup with a 10-minute interval.
- [x] Add authenticated create/update/delete zone routes under the admin API.
- [x] Protect admin API routes with the `ADMIN_API_KEY` environment variable.
- [x] Emit internal `EventEmitter` zone-change events for alert processing and map updates.
- [x] Add FIRMS and admin settings to `.env.example`.

**Relevant Context:**
- NASA FIRMS Area API endpoint: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{API_KEY}/VIIRS_SNPP_NRT/{bbox}/{days}`.
- FIRMS returns CSV rows with lat, lon, FRP (fire radiative power), confidence. Buffer each point by e.g. 500m to create a polygon: `ST_Buffer(point::geography, 500)`.
- FRP threshold for `imminent` vs `approaching` can start at a configurable env var `FIRMS_IMMINENT_FRP_THRESHOLD` (default: 50).

---

### Sub-Task 5 — Alert Engine (Risk Assessment & SMS Dispatch)

**Status:** [x] done

**Intent:**
When danger zones change, determine which residents are at risk, at what tier, and send them the appropriate SMS. Track that alerts have been sent to avoid duplicates. Handle inbound SMS replies (mock webhook) to capture transport requests.

**Expected Outcomes:**
- When a zone event fires, the engine queries residents within the zone's radius using PostGIS `ST_DWithin`.
- Residents in `imminent` zones get the short evacuate-immediately message; `approaching` zone residents get the advisory + transport offer.
- Each alert is recorded in the `alerts` table; residents who already have a sent alert for this zone are skipped.
- An inbound reply handler processes "YES" replies and creates a `transport_requests` record with correct priority.
- The mock SMS service logs all messages to console and `sms_log` table.

**Todo List:**
- [x] Define `SmsService` and implement `MockSmsService`, logging messages and inserting them into `sms_log`.
- [x] Create an alert engine that handles zone-change events, checks residents with PostGIS proximity queries, sends tiered messages, and records alerts.
- [x] Define approaching and imminent alert templates with a transport request reply option.
- [x] Handle inbound resident replies and create prioritized transport requests.
- [x] Prevent duplicate alerts with a database uniqueness constraint and conflict handling.
- [x] Register the mock SMS implementation on the Fastify app so it can be replaced later.

**Relevant Context:**
- Proximity radii (configurable env vars): `APPROACHING_RADIUS_M` (default 10000m / 10km), `IMMINENT_RADIUS_M` (default 2000m / 2km).
- The inbound webhook simulates Twilio's webhook — same shape, so dropping in real Twilio later requires only pointing Twilio's webhook URL at this endpoint.
- PostGIS query pattern: `SELECT id FROM residents WHERE ST_DWithin(location, $zoneGeom, $radiusMetres)`.

---

### Sub-Task 6 — Transport Queue & Driver Dispatch Engine

**Status:** [x] done

**Intent:**
Manage the priority queue of residents requesting transport and dispatch available drivers to the highest-priority residents first.

**Expected Outcomes:**
- `GET /admin/transport-queue` returns residents ordered by priority then created_at.
- When a new transport request is created, the dispatch engine immediately tries to assign the nearest available driver.
- Assigned driver receives an SMS with the resident's name, address/coordinates, and a reply prompt ("Reply ACCEPT or DECLINE").
- Driver reply webhook updates the dispatch record and, on DECLINE, re-queues the request and tries the next driver.
- `PATCH /admin/transport-requests/:id/complete` marks a request as completed and frees the driver.

**Todo List:**
- [x] Create `packages/api/src/services/dispatch-engine.ts` to select a nearby available driver and send a mock dispatch SMS.
- [x] Handle driver ACCEPT/DECLINE replies in the inbound SMS webhook and retry dispatch after a decline.
- [x] Add an admin transport-queue endpoint ordered by priority and request time.
- [x] On acceptance, update dispatch/request status and mark the driver unavailable.
- [x] On decline, mark the dispatch declined and try another nearby driver.
- [x] On completion, complete the request, free the driver, and refresh the live map.

**Relevant Context:**
- Driver distance query: `SELECT id FROM drivers WHERE available = true ORDER BY ST_Distance(service_area, $residentLocation) ASC LIMIT 1`.
- Imminent-zone residents (`priority = 1`) must always be dequeued before approaching-zone residents (`priority = 2`), regardless of arrival time.
- The same `sms-webhook` route handles both resident and driver replies — distinguish by checking if the `from` phone belongs to a driver or resident.

---

### Sub-Task 7 — Heatmap API & Server-Sent Events

**Status:** [x] done

**Intent:**
Provide the frontend with a live data feed of danger zones and per-grid-cell resident status. Use SSE so the map updates in real time without polling.

**Expected Outcomes:**
- `GET /api/v1/heatmap/zones` returns all active danger zones as GeoJSON.
- `GET /api/v1/heatmap/grid` returns a GeoJSON FeatureCollection where each feature is a grid cell with properties: `helped` (completed transports), `waiting` (assigned or waiting requests), `at_risk` (residents with active imminent/approaching alerts and no transport request).
- `GET /api/v1/heatmap/stream` is an SSE endpoint; whenever a zone, alert, or transport status changes, it pushes an updated heatmap snapshot to all connected clients.
- Grid cell size is configurable via `HEATMAP_GRID_DEGREES` env var (default: 0.01 degrees ≈ 1km).

**Todo List:**
- [x] Create `packages/api/src/routes/heatmap.ts` with the three endpoints above.
- [x] Implement grid cell aggregation query using `ST_SnapToGrid` on resident locations, grouped by grid cell.
- [x] Create `packages/api/src/services/sse-broadcaster.ts` — maintains a `Set` of active SSE response objects; exposes a `broadcast(event, data)` method.
- [x] Refresh and broadcast heatmap snapshots after zone, alert, dispatch, registration, and admin data changes.
- [x] Implement SSE keep-alive ping every 30 seconds to prevent connection timeouts.
- [x] Add `HEATMAP_GRID_DEGREES` to `.env.example`.

**Relevant Context:**
- SSE response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Fastify SSE: use `reply.raw` to write directly to the underlying Node.js response stream.
- Grid query pattern: `SELECT ST_SnapToGrid(location::geometry, $gridDeg) AS cell, COUNT(*) FROM residents GROUP BY cell`.

---

### Sub-Task 8 — Frontend: Live Map & Registration Pages

**Status:** [x] done

**Intent:**
Build the React frontend around the live incident map, with address/device/test-location input, risk context and resident guidance, plus resident and driver registration routes.

**Expected Outcomes:**
- `/` — live Leaflet map with OpenStreetMap tiles, displayed in grayscale while incident polygons retain severity colors. A floating sidebar shows location tools, active zones and resident counts. Users can search for an address, use device location, or choose a test location; nearby risk displays incident details and guidance/chat.
- `/register/resident` — form to register a resident (name, phone, address with geocoding OR lat/lng input).
- `/register/driver` — form to register a driver (name, phone, current location).
- Heatmap auto-updates via SSE connection to `/api/v1/heatmap/stream`.
- Driver View and Admin Debug are accessible as primary navigation tabs; resident/driver registration remain direct routes rather than primary tabs.
- Responsive layout with collapsible map side panels.

**Todo List:**
- [x] Install `leaflet`, `react-leaflet`, `@types/leaflet` in `packages/web`.
- [x] Create `src/pages/HeatmapPage.tsx` — initialise Leaflet map centred on configured default coordinates, add OpenStreetMap tile layer.
- [x] Create `src/hooks/useHeatmapStream.ts` — opens an `EventSource` to the SSE endpoint and returns the latest heatmap data via React state.
- [x] Render danger zone polygons as `Polygon` layers coloured by severity.
- [x] Render grid cells as `Rectangle` layers with fill opacity proportional to `at_risk` count; on click show popup with stats.
- [x] Create `src/pages/ResidentRegistrationPage.tsx` — form with name, phone (E.164), lat/lng fields; `POST /api/v1/residents` on submit.
- [x] Create `src/pages/DriverRegistrationPage.tsx` — form with name, phone, lat/lng; `POST /api/v1/drivers` on submit.
- [x] Set up React Router with routes `/`, `/register/resident`, `/register/driver`.
- [x] Add primary navigation for Live Map, Driver View, and Admin Debug; keep registration routes available separately.
- [x] Configure Vite proxy to forward `/api` requests to the Fastify backend (avoids CORS in dev).
- [x] Add a brief welcome state before the live map sidebar and subtle interface motion.
- [x] Add address search, device location, test-near-incident controls, zone selection highlighting, and consistent incident popups.
- [x] Add collapsible side panels and resident risk guidance/chat on the live map.
- [x] Style the Leaflet basemap in grayscale while keeping incident severity overlays colored.

**Relevant Context:**
- `react-leaflet` v4+ requires Leaflet CSS to be imported manually: `import 'leaflet/dist/leaflet.css'`.
- Vite proxy config: `server.proxy: { '/api': 'http://localhost:3000' }` in `vite.config.ts`.
- SSE in React: use `useEffect` to create `new EventSource('/api/v1/heatmap/stream')` and clean up on unmount.

---

### Sub-Task 9 — Driver View & Resident Communications

**Status:** [x] done

**Intent:**
Give drivers a local view of active transport requests near their registered location, with controls to respond and review or message the resident associated with a request.

**Expected Outcomes:**
- `/driver` identifies a driver profile and shows nearby requests within a configurable service radius (25 miles by default).
- Drivers can accept or decline a pending request and update their availability.
- Opening a request shows that resident's SMS history and allows the driver to send a message through the mock SMS service.
- Requests are reassigned after a driver declines, and out-of-radius requests are excluded from automatic dispatch.

**Todo List:**
- [x] Add driver identification and nearby-request endpoints, using the driver's registered location and `DRIVER_REQUEST_RADIUS_M`.
- [x] Add per-request conversation history and message endpoints scoped to the driver and service radius.
- [x] Add request acceptance and decline actions to the driver view.
- [x] Add the `/driver` route and Driver View navigation tab.
- [x] Save the newly registered driver profile locally and provide phone-based profile lookup for returning drivers.
- [x] Remove the former SMS Simulator UI and its message-list endpoint; retain the inbound SMS webhook and SMS log for the transport workflow.

**Relevant Context:**
- `DRIVER_REQUEST_RADIUS_M` defaults to 40,234 metres (25 miles).
- The driver profile lookup is for this local development scaffold; production authentication remains future work.

---

### Sub-Task 10 — Admin Debug View

**Status:** [x] done

**Intent:**
Provide a convenient local-only view for inspecting and editing resident, driver, and danger-zone records while developing and testing the workflow.

**Expected Outcomes:**
- `/admin` presents residents, drivers, and zones in searchable, readable tables with summary counts.
- Create, update, and delete operations are available for residents, drivers, and zones through the admin API.
- Admin API requests require the configured `ADMIN_API_KEY`.
- Record changes refresh the relevant data and broadcast heatmap updates where needed.

**Todo List:**
- [x] Add admin overview API for listing residents, drivers, and zones.
- [x] Add create/update/delete endpoints for residents, drivers, and zones.
- [x] Add a key entry flow and persist the local debug key in browser storage.
- [x] Add searchable tables and editor forms to the Admin Debug tab.
- [x] Add confirmation and clear feedback for destructive actions and API errors.

**Relevant Context:**
- This is a local development/debugging interface, not a production admin authentication system.
- Zone creation currently uses rectangular bounds; editing an existing zone changes its severity or active state, not its polygon geometry.

---

## Architecture Reference

```
packages/
  api/
    src/
      routes/
        residents.ts
        drivers.ts
        driver-view.ts
        heatmap.ts
        sms-webhook.ts
        admin/
          overview.ts
          transport-queue.ts
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
        DriverViewPage.tsx
        AdminDebugPage.tsx
        ResidentRegistrationPage.tsx
        DriverRegistrationPage.tsx
      components/
        AddressSearch.tsx
      hooks/
        useHeatmapStream.ts
      App.tsx
      main.tsx
docker-compose.yml
.env.example
package.json          # npm workspaces root
```

## Known Follow-Up Work

- [ ] Reconcile and deduplicate FIRMS hotspots on repeated polls; current sync inserts buffered hotspot records and does not expire or merge stale records.
- [ ] Allow Admin Debug to edit an existing zone's polygon geometry.
- [ ] Add production-grade authentication before exposing driver or admin views outside local development.

## Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5433/disasteralert` |
| `NASA_FIRMS_API_KEY` | Free key from FIRMS portal | — |
| `FIRMS_BOUNDING_BOX` | `minLon,minLat,maxLon,maxLat` | — |
| `FIRMS_IMMINENT_FRP_THRESHOLD` | FRP value above which zone is imminent | `50` |
| `APPROACHING_RADIUS_M` | Distance in metres for approaching alert | `10000` |
| `IMMINENT_RADIUS_M` | Distance in metres for imminent alert | `2000` |
| `HEATMAP_GRID_DEGREES` | Grid cell size in degrees | `0.01` |
| `DRIVER_REQUEST_RADIUS_M` | Driver request search radius in metres | `40234` |
| `ADMIN_API_KEY` | Key for admin route access | — |
| `PORT` | API server port | `3000` |
| `CORS_ORIGIN` | Frontend origin for CORS | `http://localhost:5173` |
