import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db.js';
import type { SmsService } from '../services/sms.js';
import { startDispatchEngine } from '../services/dispatch-engine.js';
import { pushHeatmapUpdate } from './heatmap.js';

const webhookSchema = {
  body: {
    type: 'object',
    required: ['from', 'body'],
    properties: {
      from: { type: 'string' },
      body: { type: 'string' },
    },
    additionalProperties: false,
  },
} as const;

export async function smsWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { schema: webhookSchema }, async (request, reply) => {
    const { from, body: replyText } = request.body as { from: string; body: string };
    const text = replyText.trim().toUpperCase();

    await db.query(`INSERT INTO sms_log (to_phone, body, direction) VALUES ($1, $2, 'inbound')`, [
      from,
      replyText,
    ]);

    // Check if sender is a driver
    const { rows: driverRows } = await db.query<{ id: string }>(
      `SELECT id FROM drivers WHERE phone = $1`,
      [from],
    );
    if (driverRows.length > 0) {
      await handleDriverReply(app, driverRows[0]!.id, text);
      return reply.status(200).send({ ok: true });
    }

    // Check if sender is a resident
    const { rows: residentRows } = await db.query<{ id: string }>(
      `SELECT id FROM residents WHERE phone = $1`,
      [from],
    );
    if (residentRows.length > 0) {
      await handleResidentReply(app, residentRows[0]!.id, text);
    }

    return reply.status(200).send({ ok: true });
  });
}

async function handleResidentReply(
  app: FastifyInstance,
  residentId: string,
  text: string,
): Promise<void> {
  if (text !== 'YES') return;

  // Find the latest unanswered alert
  const { rows: alertRows } = await db.query<{
    id: string;
    tier: 'approaching' | 'imminent';
  }>(
    `SELECT id, tier FROM alerts
     WHERE resident_id = $1 AND response IS NULL
     ORDER BY sent_at DESC LIMIT 1`,
    [residentId],
  );
  if (alertRows.length === 0) return;

  const alert = alertRows[0]!;
  const priority = alert.tier === 'imminent' ? 1 : 2;

  await db.query(
    `UPDATE alerts SET response = 'requested_transport', responded_at = NOW() WHERE id = $1`,
    [alert.id],
  );

  // Skip if already queued
  const { rows: existing } = await db.query(
    `SELECT id FROM transport_requests WHERE resident_id = $1 AND status IN ('waiting','assigned')`,
    [residentId],
  );
  if (existing.length > 0) return;

  const { rows: trRows } = await db.query<{ id: string }>(
    `INSERT INTO transport_requests (resident_id, tier, priority) VALUES ($1, $2, $3) RETURNING id`,
    [residentId, alert.tier, priority],
  );

  pushHeatmapUpdate().catch(() => null);

  console.log(`[sms-webhook] Resident ${residentId} requested transport (priority ${priority})`);

  const sms: SmsService = app.sms;
  startDispatchEngine(sms, trRows[0]!.id).catch((err) =>
    console.error('[sms-webhook] Dispatch error:', err),
  );
}

async function handleDriverReply(
  app: FastifyInstance,
  driverId: string,
  text: string,
): Promise<void> {
  const { rows: dispatchRows } = await db.query<{
    id: string;
    transport_request_id: string;
  }>(
    `SELECT id, transport_request_id FROM driver_dispatches
     WHERE driver_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [driverId],
  );
  if (dispatchRows.length === 0) return;

  const dispatch = dispatchRows[0]!;
  const sms: SmsService = app.sms;

  if (text === 'ACCEPT') {
    await db.query(
      `UPDATE driver_dispatches SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
      [dispatch.id],
    );
    await db.query(
      `UPDATE transport_requests
       SET status = 'assigned', driver_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [driverId, dispatch.transport_request_id],
    );
    await db.query(`UPDATE drivers SET available = false WHERE id = $1`, [driverId]);
    console.log(`[sms-webhook] Driver ${driverId} accepted dispatch ${dispatch.id}`);
    pushHeatmapUpdate().catch(() => null);
  } else if (text === 'DECLINE') {
    await db.query(
      `UPDATE driver_dispatches SET status = 'declined', updated_at = NOW() WHERE id = $1`,
      [dispatch.id],
    );
    console.log(`[sms-webhook] Driver ${driverId} declined — retrying`);
    pushHeatmapUpdate().catch(() => null);
    startDispatchEngine(sms, dispatch.transport_request_id, driverId).catch((err) =>
      console.error('[sms-webhook] Re-dispatch error:', err),
    );
  }
}

// Fastify type augmentation for app.sms
declare module 'fastify' {
  interface FastifyInstance {
    sms: SmsService;
  }
}

// Satisfy unused import lint rule
export type { FastifyReply };
