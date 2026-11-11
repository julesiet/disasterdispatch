import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';

// Singleton event bus for internal zone-change notifications
export const zoneEvents = new EventEmitter();

export type ZoneChangedPayload = {
  id: string;
  severity: 'approaching' | 'imminent';
  active: boolean;
};

import { db } from '../db.js';
import { parse } from 'csv-parse/sync';

const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const BUFFER_METRES = 500;

type FirmsRow = {
  latitude: string;
  longitude: string;
  frp: string;
  confidence: string;
};

export async function syncFirms(): Promise<void> {
  const apiKey = process.env['NASA_FIRMS_API_KEY'];
  const bbox = process.env['FIRMS_BOUNDING_BOX'];
  const frpThreshold = Number(process.env['FIRMS_IMMINENT_FRP_THRESHOLD'] ?? 50);

  if (!apiKey || apiKey === 'your_firms_api_key_here') {
    console.warn('[firms-sync] NASA_FIRMS_API_KEY not set — skipping live sync');
    return;
  }
  if (!bbox) {
    console.warn('[firms-sync] FIRMS_BOUNDING_BOX not set — skipping live sync');
    return;
  }

  const url = `${FIRMS_URL}/${apiKey}/VIIRS_SNPP_NRT/${bbox}/1`;
  let csvText: string;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[firms-sync] HTTP ${res.status} from FIRMS API`);
      return;
    }
    csvText = await res.text();
  } catch (err) {
    console.error('[firms-sync] Network error:', err);
    return;
  }

  let rows: FirmsRow[];
  try {
    rows = parse(csvText, { columns: true, skip_empty_lines: true }) as FirmsRow[];
  } catch {
    console.warn('[firms-sync] Failed to parse FIRMS CSV');
    return;
  }

  if (rows.length === 0) {
    console.log('[firms-sync] No active fire hotspots in bounding box');
    return;
  }

  let upserted = 0;
  for (const row of rows) {
    const lat = parseFloat(row.latitude);
    const lng = parseFloat(row.longitude);
    const frp = parseFloat(row.frp);
    if (isNaN(lat) || isNaN(lng)) continue;

    const severity: 'approaching' | 'imminent' = frp >= frpThreshold ? 'imminent' : 'approaching';

    const { rows: result } = await db.query<{ id: string }>(
      `INSERT INTO danger_zones (source, zone, severity, active)
       VALUES (
         'firms',
         ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)::geography,
         $4,
         true
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [lng, lat, BUFFER_METRES, severity],
    );

    if (result[0]) {
      upserted++;
      zoneEvents.emit('zone:changed', {
        id: result[0].id,
        severity,
        active: true,
      } satisfies ZoneChangedPayload);
    }
  }

  console.log(`[firms-sync] Upserted ${upserted} hotspots from ${rows.length} FIRMS records`);
}

export function startFirmsPoller(intervalMs = 10 * 60 * 1000): void {
  syncFirms().catch((err) => console.error('[firms-sync] Initial sync error:', err));
  setInterval(() => {
    syncFirms().catch((err) => console.error('[firms-sync] Sync error:', err));
  }, intervalMs);
}

// Admin route plugin
const createZoneSchema = {
  body: {
    type: 'object',
    required: ['severity', 'polygon'],
    properties: {
      severity: { type: 'string', enum: ['approaching', 'imminent'] },
      // polygon: array of [lng, lat] ring coordinates
      polygon: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          minItems: 4,
        },
        minItems: 1,
      },
    },
    additionalProperties: false,
  },
} as const;

const idParamSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
} as const;

const patchZoneSchema = {
  params: idParamSchema.params,
  body: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['approaching', 'imminent'] },
      active: { type: 'boolean' },
    },
    additionalProperties: false,
  },
} as const;

export async function dangerZonesRoutes(app: FastifyInstance): Promise<void> {
  // Admin key guard
  app.addHook('onRequest', async (request, reply) => {
    const key = request.headers['x-api-key'];
    if (key !== process.env['ADMIN_API_KEY']) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // POST /api/v1/admin/danger-zones
  app.post('/', { schema: createZoneSchema }, async (request, reply) => {
    const { severity, polygon } = request.body as {
      severity: 'approaching' | 'imminent';
      polygon: number[][][];
    };

    // Build a WKT polygon from the ring coordinates [[lng,lat],...]
    const ring = polygon[0]!;
    const coords = ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
    const wkt = `POLYGON((${coords}))`;

    const { rows } = await db.query<{ id: string; severity: string; active: boolean }>(
      `INSERT INTO danger_zones (source, zone, severity, active)
       VALUES ('admin', ST_GeogFromText($1), $2, true)
       RETURNING id, source, severity, active, created_at`,
      [wkt, severity],
    );

    zoneEvents.emit('zone:changed', {
      id: rows[0]!.id,
      severity,
      active: true,
    } satisfies ZoneChangedPayload);

    return reply.status(201).send(rows[0]);
  });

  // PATCH /api/v1/admin/danger-zones/:id
  app.patch('/:id', { schema: patchZoneSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { severity?: string; active?: boolean };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (body.severity !== undefined) {
      values.push(body.severity);
      setClauses.push(`severity = $${values.length}`);
    }
    if (body.active !== undefined) {
      values.push(body.active);
      setClauses.push(`active = $${values.length}`);
    }
    if (setClauses.length === 0) {
      return reply.status(400).send({ error: 'Nothing to update' });
    }
    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await db.query(
      `UPDATE danger_zones SET ${setClauses.join(', ')} WHERE id = $${values.length}
       RETURNING id, source, severity, active, updated_at`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Zone not found' });

    zoneEvents.emit('zone:changed', {
      id: rows[0].id,
      severity: rows[0].severity,
      active: rows[0].active,
    } satisfies ZoneChangedPayload);

    return rows[0];
  });

  // DELETE /api/v1/admin/danger-zones/:id  (soft delete — sets active = false)
  app.delete('/:id', { schema: idParamSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(
      `UPDATE danger_zones SET active = false, updated_at = NOW()
       WHERE id = $1 RETURNING id, severity, active`,
      [id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Zone not found' });

    zoneEvents.emit('zone:changed', {
      id: rows[0].id,
      severity: rows[0].severity,
      active: false,
    } satisfies ZoneChangedPayload);

    return reply.status(200).send(rows[0]);
  });
}
