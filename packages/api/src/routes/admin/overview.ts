import type { FastifyInstance } from 'fastify';
import { db } from '../../db.js';
import { zoneEvents } from '../../services/firms-sync.js';
import { pushHeatmapUpdate } from '../heatmap.js';

const uuidParams = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
} as const;

const residentSchema = {
  body: {
    type: 'object',
    required: ['name', 'phone', 'lat', 'lng'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      phone: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
    },
    additionalProperties: false,
  },
} as const;

const driverSchema = {
  body: {
    type: 'object',
    required: ['name', 'phone', 'lat', 'lng', 'available'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      phone: { type: 'string', pattern: '^\\+[1-9]\\d{1,14}$' },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      available: { type: 'boolean' },
    },
    additionalProperties: false,
  },
} as const;

const zoneSchema = {
  body: {
    type: 'object',
    required: ['severity', 'south', 'west', 'north', 'east'],
    properties: {
      severity: { type: 'string', enum: ['approaching', 'imminent'] },
      south: { type: 'number', minimum: -90, maximum: 90 },
      west: { type: 'number', minimum: -180, maximum: 180 },
      north: { type: 'number', minimum: -90, maximum: 90 },
      east: { type: 'number', minimum: -180, maximum: 180 },
    },
    additionalProperties: false,
  },
} as const;

const zoneUpdateSchema = {
  ...uuidParams,
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      severity: { type: 'string', enum: ['approaching', 'imminent'] },
      active: { type: 'boolean' },
    },
    additionalProperties: false,
  },
} as const;

type PersonInput = { name: string; phone: string; lat: number; lng: number };
type DriverInput = PersonInput & { available: boolean };

function uniquePhoneError(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

export async function adminOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const expectedKey = process.env['ADMIN_API_KEY'];
    if (!expectedKey || request.headers['x-api-key'] !== expectedKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/', async () => {
    const [drivers, residents, zones] = await Promise.all([
      db.query(`
        SELECT id, name, phone, available,
               ST_Y(service_area::geometry) AS lat,
               ST_X(service_area::geometry) AS lng,
               created_at
        FROM drivers
        ORDER BY created_at DESC
      `),
      db.query(`
        SELECT id, name, phone,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng,
               created_at
        FROM residents
        ORDER BY created_at DESC
      `),
      db.query(`
        SELECT id, source, severity, active,
               ST_Y(ST_PointOnSurface(zone::geometry)) AS lat,
               ST_X(ST_PointOnSurface(zone::geometry)) AS lng,
               created_at, updated_at
        FROM danger_zones
        ORDER BY active DESC, created_at DESC
      `),
    ]);

    return {
      drivers: drivers.rows,
      residents: residents.rows,
      zones: zones.rows,
      generated_at: new Date().toISOString(),
    };
  });

  app.post('/residents', { schema: residentSchema }, async (request, reply) => {
    const { name, phone, lat, lng } = request.body as PersonInput;
    try {
      const { rows } = await db.query(
        `INSERT INTO residents (name, phone, location)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         RETURNING id, name, phone, ST_Y(location::geometry) AS lat,
                   ST_X(location::geometry) AS lng, created_at`,
        [name.trim(), phone.trim(), lng, lat],
      );
      pushHeatmapUpdate().catch(() => null);
      return reply.status(201).send(rows[0]);
    } catch (error) {
      if (uniquePhoneError(error)) return reply.status(409).send({ error: 'Phone number already registered.' });
      throw error;
    }
  });

  app.patch('/residents/:id', { schema: { ...uuidParams, ...residentSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, phone, lat, lng } = request.body as PersonInput;
    try {
      const { rows } = await db.query(
        `UPDATE residents SET name = $1, phone = $2,
                location = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
         WHERE id = $5
         RETURNING id, name, phone, ST_Y(location::geometry) AS lat,
                   ST_X(location::geometry) AS lng, created_at`,
        [name.trim(), phone.trim(), lng, lat, id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Resident not found.' });
      pushHeatmapUpdate().catch(() => null);
      return rows[0];
    } catch (error) {
      if (uniquePhoneError(error)) return reply.status(409).send({ error: 'Phone number already registered.' });
      throw error;
    }
  });

  app.delete('/residents/:id', { schema: uuidParams }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query('DELETE FROM residents WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Resident not found.' });
    pushHeatmapUpdate().catch(() => null);
    return { ok: true };
  });

  app.post('/drivers', { schema: driverSchema }, async (request, reply) => {
    const { name, phone, lat, lng, available } = request.body as DriverInput;
    try {
      const { rows } = await db.query(
        `INSERT INTO drivers (name, phone, service_area, available)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
         RETURNING id, name, phone, available,
                   ST_Y(service_area::geometry) AS lat,
                   ST_X(service_area::geometry) AS lng, created_at`,
        [name.trim(), phone.trim(), lng, lat, available],
      );
      return reply.status(201).send(rows[0]);
    } catch (error) {
      if (uniquePhoneError(error)) return reply.status(409).send({ error: 'Phone number already registered.' });
      throw error;
    }
  });

  app.patch('/drivers/:id', { schema: { ...uuidParams, ...driverSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, phone, lat, lng, available } = request.body as DriverInput;
    try {
      const { rows } = await db.query(
        `UPDATE drivers SET name = $1, phone = $2,
                service_area = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
                available = $5
         WHERE id = $6
         RETURNING id, name, phone, available,
                   ST_Y(service_area::geometry) AS lat,
                   ST_X(service_area::geometry) AS lng, created_at`,
        [name.trim(), phone.trim(), lng, lat, available, id],
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Driver not found.' });
      return rows[0];
    } catch (error) {
      if (uniquePhoneError(error)) return reply.status(409).send({ error: 'Phone number already registered.' });
      throw error;
    }
  });

  app.delete('/drivers/:id', { schema: uuidParams }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: activeAssignments } = await client.query(
        `SELECT id FROM transport_requests
         WHERE driver_id = $1 AND status = 'assigned'
         LIMIT 1 FOR UPDATE`,
        [id],
      );
      if (activeAssignments.length > 0) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This driver has an active assigned request. Complete or reassign it before deleting the driver.' });
      }
      await client.query('UPDATE transport_requests SET driver_id = NULL WHERE driver_id = $1', [id]);
      const { rows } = await client.query('DELETE FROM drivers WHERE id = $1 RETURNING id', [id]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Driver not found.' });
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/zones', { schema: zoneSchema }, async (request, reply) => {
    const { severity, south, west, north, east } = request.body as {
      severity: 'approaching' | 'imminent'; south: number; west: number; north: number; east: number;
    };
    if (south >= north || west >= east) return reply.status(400).send({ error: 'North must be above south and east must be east of west.' });
    const wkt = `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
    const { rows } = await db.query(
      `INSERT INTO danger_zones (source, zone, severity, active)
       VALUES ('admin', ST_GeogFromText($1), $2, true)
       RETURNING id, source, severity, active, created_at, updated_at`,
      [wkt, severity],
    );
    zoneEvents.emit('zone:changed', { id: rows[0]!.id, severity, active: true });
    return reply.status(201).send(rows[0]);
  });

  app.patch('/zones/:id', { schema: zoneUpdateSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { severity, active } = request.body as { severity?: 'approaching' | 'imminent'; active?: boolean };
    const values: unknown[] = [];
    const changes: string[] = [];
    if (severity !== undefined) { values.push(severity); changes.push(`severity = $${values.length}`); }
    if (active !== undefined) { values.push(active); changes.push(`active = $${values.length}`); }
    values.push(id);
    const { rows } = await db.query(
      `UPDATE danger_zones SET ${changes.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, source, severity, active, created_at, updated_at`,
      values,
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Zone not found.' });
    zoneEvents.emit('zone:changed', { id, severity: rows[0]!.severity, active: rows[0]!.active });
    return rows[0];
  });

  app.delete('/zones/:id', { schema: uuidParams }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(
      'DELETE FROM danger_zones WHERE id = $1 RETURNING id, severity',
      [id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Zone not found.' });
    zoneEvents.emit('zone:changed', { id, severity: rows[0]!.severity, active: false });
    return { ok: true };
  });
}
