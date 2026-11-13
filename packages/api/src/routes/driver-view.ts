import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { pushHeatmapUpdate } from './heatmap.js';
import { startDispatchEngine } from '../services/dispatch-engine.js';
import type { SmsService } from '../services/sms.js';

const DEFAULT_REQUEST_RADIUS_M = 25 * 1609.344;

function getRequestRadiusM(): number {
  const configuredRadius = Number(process.env['DRIVER_REQUEST_RADIUS_M'] ?? DEFAULT_REQUEST_RADIUS_M);
  return Number.isFinite(configuredRadius) && configuredRadius > 0
    ? configuredRadius
    : DEFAULT_REQUEST_RADIUS_M;
}

const phonePattern = '^\\+[1-9]\\d{1,14}$';

const identifySchema = {
  body: {
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string', pattern: phonePattern } },
    additionalProperties: false,
  },
} as const;

const driverParamsSchema = {
  params: {
    type: 'object',
    required: ['driverId'],
    properties: { driverId: { type: 'string', format: 'uuid' } },
  },
} as const;

const requestParamsSchema = {
  params: {
    type: 'object',
    required: ['driverId', 'requestId'],
    properties: {
      driverId: { type: 'string', format: 'uuid' },
      requestId: { type: 'string', format: 'uuid' },
    },
  },
} as const;

const messageSchema = {
  params: requestParamsSchema.params,
  body: {
    type: 'object',
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 500 } },
    additionalProperties: false,
  },
} as const;

const responseSchema = {
  params: requestParamsSchema.params,
  body: {
    type: 'object',
    required: ['response'],
    properties: { response: { type: 'string', enum: ['ACCEPT', 'DECLINE'] } },
    additionalProperties: false,
  },
} as const;

type RequestParams = { driverId: string; requestId: string };

async function getAccessibleRequest(driverId: string, requestId: string) {
  const radiusM = getRequestRadiusM();
  const { rows } = await db.query<{
    resident_id: string;
    resident_name: string;
    resident_phone: string;
    request_status: string;
  }>(
    `SELECT r.id AS resident_id, r.name AS resident_name, r.phone AS resident_phone,
            tr.status AS request_status
     FROM transport_requests tr
     JOIN residents r ON r.id = tr.resident_id
     JOIN drivers d ON d.id = $1
     LEFT JOIN LATERAL (
       SELECT dd.driver_id, dd.status
       FROM driver_dispatches dd
       WHERE dd.transport_request_id = tr.id
       ORDER BY dd.created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE tr.id = $2
       AND ST_DWithin(d.service_area, r.location, $3)
       AND (
         (tr.status = 'waiting' AND (latest.status IS DISTINCT FROM 'pending' OR latest.driver_id = d.id))
         OR (tr.status IN ('assigned', 'completed') AND (tr.driver_id = d.id OR latest.driver_id = d.id))
       )`,
    [driverId, requestId, radiusM],
  );
  return rows[0];
}

export async function driverViewRoutes(app: FastifyInstance): Promise<void> {
  // Local scaffold identity lookup. Production deployments should add driver authentication.
  app.post('/identify', { schema: identifySchema }, async (request, reply) => {
    const radiusM = getRequestRadiusM();
    const { phone } = request.body as { phone: string };
    const { rows } = await db.query<{
      id: string;
      name: string;
      phone: string;
      available: boolean;
      lat: number;
      lng: number;
    }>(
      `SELECT id, name, phone, available,
              ST_Y(service_area::geometry) AS lat,
              ST_X(service_area::geometry) AS lng
       FROM drivers WHERE phone = $1`,
      [phone.trim()],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'No driver profile found for that phone.' });
    return { driver: rows[0], radius_m: radiusM };
  });

  app.get('/:driverId/requests', { schema: driverParamsSchema }, async (request, reply) => {
    const radiusM = getRequestRadiusM();
    const { driverId } = request.params as { driverId: string };
    const { rows: driverRows } = await db.query<{
      id: string;
      name: string;
      phone: string;
      available: boolean;
      lat: number;
      lng: number;
    }>(
      `SELECT id, name, phone, available,
              ST_Y(service_area::geometry) AS lat,
              ST_X(service_area::geometry) AS lng
       FROM drivers WHERE id = $1`,
      [driverId],
    );
    if (driverRows.length === 0) return reply.status(404).send({ error: 'Driver profile not found.' });

    const { rows: requests } = await db.query(
      `SELECT tr.id, tr.status, tr.tier, tr.priority, tr.created_at,
              r.id AS resident_id, r.name AS resident_name, r.phone AS resident_phone,
              ST_Y(r.location::geometry) AS lat,
              ST_X(r.location::geometry) AS lng,
              ST_Distance(d.service_area, r.location)::int AS distance_m,
              latest.status AS dispatch_status,
              (latest.driver_id = d.id AND latest.status = 'pending') AS pending_for_driver,
              (latest.driver_id = d.id AND latest.status = 'accepted') AS assigned_to_driver
       FROM transport_requests tr
       JOIN residents r ON r.id = tr.resident_id
       JOIN drivers d ON d.id = $1
       LEFT JOIN LATERAL (
         SELECT dd.driver_id, dd.status
         FROM driver_dispatches dd
         WHERE dd.transport_request_id = tr.id
         ORDER BY dd.created_at DESC
         LIMIT 1
       ) latest ON true
       WHERE ST_DWithin(d.service_area, r.location, $2)
         AND (
           tr.status = 'waiting'
           OR (tr.status IN ('assigned', 'completed')
             AND (tr.driver_id = d.id OR latest.driver_id = d.id))
         )
       ORDER BY
         CASE WHEN tr.status = 'assigned' THEN 0 WHEN tr.status = 'waiting' THEN 1 ELSE 2 END,
         tr.priority ASC, tr.created_at ASC`,
      [driverId, radiusM],
    );

    return {
      driver: driverRows[0],
      radius_m: radiusM,
      requests,
    };
  });

  app.get('/:driverId/requests/:requestId/messages', { schema: requestParamsSchema }, async (request, reply) => {
    const { driverId, requestId } = request.params as RequestParams;
    const resident = await getAccessibleRequest(driverId, requestId);
    if (!resident) return reply.status(404).send({ error: 'Request is outside your service area or not assigned to you.' });

    const { rows } = await db.query(
      `SELECT id, to_phone, body, direction, created_at
       FROM sms_log
       WHERE to_phone = $1
       ORDER BY created_at ASC
       LIMIT 100`,
      [resident.resident_phone],
    );
    return { resident: { id: resident.resident_id, name: resident.resident_name }, messages: rows };
  });

  app.post('/:driverId/requests/:requestId/messages', { schema: messageSchema }, async (request, reply) => {
    const { driverId, requestId } = request.params as RequestParams;
    const { body } = request.body as { body: string };
    const resident = await getAccessibleRequest(driverId, requestId);
    if (!resident) return reply.status(404).send({ error: 'Request is outside your service area or not assigned to you.' });

    const sms = app.sms as SmsService;
    await sms.send(resident.resident_phone, body.trim());
    return reply.status(201).send({ ok: true });
  });

  app.post('/:driverId/requests/:requestId/respond', { schema: responseSchema }, async (request, reply) => {
    const radiusM = getRequestRadiusM();
    const { driverId, requestId } = request.params as RequestParams;
    const { response } = request.body as { response: 'ACCEPT' | 'DECLINE' };
    const client = await db.connect();
    let declined = false;

    try {
      await client.query('BEGIN');
      const { rows: requestRows } = await client.query<{
        status: string;
        available: boolean;
      }>(
        `SELECT tr.status, d.available
         FROM transport_requests tr
         JOIN residents r ON r.id = tr.resident_id
         JOIN drivers d ON d.id = $1
         WHERE tr.id = $2 AND ST_DWithin(d.service_area, r.location, $3)
         FOR UPDATE OF tr, d`,
        [driverId, requestId, radiusM],
      );
      if (requestRows.length === 0) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Request is outside your service area.' });
      }
      if (requestRows[0]!.status !== 'waiting') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This request is no longer waiting for a driver.' });
      }

      const { rows: dispatchRows } = await client.query<{
        id: string;
        driver_id: string;
        status: string;
      }>(
        `SELECT id, driver_id, status
         FROM driver_dispatches
         WHERE transport_request_id = $1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [requestId],
      );
      const latest = dispatchRows[0];
      const pendingForOtherDriver = latest?.status === 'pending' && latest.driver_id !== driverId;
      const pendingForThisDriver = latest?.status === 'pending' && latest.driver_id === driverId;
      if (pendingForOtherDriver) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This request is currently offered to another driver.' });
      }

      if (response === 'DECLINE') {
        if (!latest || latest.status !== 'pending' || latest.driver_id !== driverId) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'There is no pending offer for this driver.' });
        }
        await client.query(
          `UPDATE driver_dispatches SET status = 'declined', updated_at = NOW() WHERE id = $1`,
          [latest.id],
        );
        declined = true;
      } else {
        const hasOtherAcceptedRequest = await client.query(
          `SELECT 1 FROM driver_dispatches dd
           JOIN transport_requests tr ON tr.id = dd.transport_request_id
           WHERE dd.driver_id = $1 AND dd.status = 'accepted'
             AND tr.status = 'assigned' AND tr.id <> $2
           LIMIT 1`,
          [driverId, requestId],
        );
        if (hasOtherAcceptedRequest.rows.length > 0 || (!requestRows[0]!.available && !pendingForThisDriver)) {
          await client.query('ROLLBACK');
          return reply.status(409).send({ error: 'This driver is already assigned to another request.' });
        }

        let dispatchId = latest?.id;
        if (!latest || latest.status !== 'pending') {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO driver_dispatches (driver_id, transport_request_id, status)
             VALUES ($1, $2, 'pending') RETURNING id`,
            [driverId, requestId],
          );
          dispatchId = rows[0]!.id;
        }
        await client.query(
          `UPDATE driver_dispatches SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
          [dispatchId],
        );
        await client.query(
          `UPDATE transport_requests
           SET status = 'assigned', driver_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [driverId, requestId],
        );
        await client.query(`UPDATE drivers SET available = false WHERE id = $1`, [driverId]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (declined) {
      startDispatchEngine(app.sms as SmsService, requestId, driverId).catch((error) =>
        app.log.error(error, 'Could not reassign declined request'),
      );
    }
    pushHeatmapUpdate().catch(() => null);
    return { ok: true, response };
  });
}
