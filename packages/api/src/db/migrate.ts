import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

const root = process.env['npm_config_local_prefix'] ?? resolve(process.cwd(), '..', '..');
dotenv.config({ path: resolve(root, '.env') });

const { Client } = pg;

const migrations: string[] = [
  // 001 — residents
  `CREATE TABLE IF NOT EXISTS residents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL UNIQUE,
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // 002 — drivers
  `CREATE TABLE IF NOT EXISTS drivers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL UNIQUE,
    service_area GEOGRAPHY(POINT, 4326) NOT NULL,
    available    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // 003 — danger_zones
  `CREATE TABLE IF NOT EXISTS danger_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT NOT NULL CHECK (source IN ('firms', 'admin')),
    zone        GEOGRAPHY(POLYGON, 4326) NOT NULL,
    severity    TEXT NOT NULL CHECK (severity IN ('approaching', 'imminent')),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // 004 — alerts
  `CREATE TABLE IF NOT EXISTS alerts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id    UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    danger_zone_id UUID NOT NULL REFERENCES danger_zones(id) ON DELETE CASCADE,
    tier           TEXT NOT NULL CHECK (tier IN ('approaching', 'imminent')),
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at   TIMESTAMPTZ,
    response       TEXT CHECK (response IN ('requested_transport', 'acknowledged')),
    UNIQUE (resident_id, danger_zone_id)
  )`,

  // 005 — transport_requests
  `CREATE TABLE IF NOT EXISTS transport_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    tier        TEXT NOT NULL CHECK (tier IN ('approaching', 'imminent')),
    status      TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'assigned', 'completed', 'cancelled')),
    priority    INT NOT NULL CHECK (priority IN (1, 2)),
    driver_id   UUID REFERENCES drivers(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // 006 — sms_log
  `CREATE TABLE IF NOT EXISTS sms_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_phone    TEXT NOT NULL,
    body        TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // 007 — driver_dispatches
  `CREATE TABLE IF NOT EXISTS driver_dispatches (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id            UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    transport_request_id UUID NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

async function migrate() {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    for (const sql of migrations) {
      await client.query(sql);
    }
    console.log(`✅  All ${migrations.length} migrations applied successfully`);
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
