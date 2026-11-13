import type { FastifyInstance } from 'fastify';
import { db } from '../../db.js';
import { pushHeatmapUpdate } from '../heatmap.js';

const completeSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
} as const;

export async function transportQueueRoutes(app: FastifyInstance): Promise<void> {
  // Admin key guard
  app.addHook('onRequest', async (request, reply) => {
    const expectedKey = process.env['ADMIN_API_KEY'];
    if (!expectedKey || request.headers['x-api-key'] !== expectedKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /api/v1/admin/transport-queue
  app.get('/', async () => {
    const { rows } = await db.query(
      `SELECT tr.id, tr.status, tr.priority, tr.tier, tr.created_at,
              r.name AS resident_name, r.phone AS resident_phone,
              ST_Y(r.location::geometry) AS lat,
              ST_X(r.location::geometry) AS lng
       FROM transport_requests tr
       JOIN residents r ON tr.resident_id = r.id
       WHERE tr.status IN ('waiting', 'assigned')
       ORDER BY tr.priority ASC, tr.created_at ASC`,
    );
    return rows;
  });

  // PATCH /api/v1/admin/transport-requests/:id/complete
  app.patch('/:id/complete', { schema: completeSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const { rows } = await db.query(
      `UPDATE transport_requests SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status = 'assigned'
       RETURNING id`,
      [id],
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Request not found or not in assigned state' });
    }

    // Mark dispatch completed and free the driver in one go
    await db.query(
      `UPDATE driver_dispatches SET status = 'completed', updated_at = NOW()
       WHERE transport_request_id = $1 AND status = 'accepted'`,
      [id],
    );
    await db.query(
      `UPDATE drivers SET available = true
       WHERE id = (
         SELECT driver_id FROM driver_dispatches
         WHERE transport_request_id = $1 AND status = 'completed'
         ORDER BY updated_at DESC LIMIT 1
       )`,
      [id],
    );

    pushHeatmapUpdate().catch(() => null);

    console.log(`[transport] Request ${id} marked complete`);
    return { ok: true };
  });
}
