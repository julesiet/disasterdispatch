import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';

const phonePattern = '^\\+[1-9]\\d{1,14}$';

const createResidentSchema = {
  body: {
    type: 'object',
    required: ['name', 'phone', 'lat', 'lng'],
    properties: {
      name: { type: 'string', minLength: 1 },
      phone: { type: 'string', pattern: phonePattern },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
    },
    additionalProperties: false,
  },
} as const;

const getResidentSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
} as const;

export async function residentsRoutes(app: FastifyInstance) {
  // POST /api/v1/residents
  app.post('/', { schema: createResidentSchema }, async (request, reply) => {
    const { name, phone, lat, lng } = request.body as {
      name: string;
      phone: string;
      lat: number;
      lng: number;
    };

    try {
      const { rows } = await db.query(
        `INSERT INTO residents (name, phone, location)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         RETURNING id, name, phone, created_at`,
        [name, phone, lng, lat],
      );
      return reply.status(201).send(rows[0]);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        return reply.status(409).send({ error: 'Phone number already registered' });
      }
      throw err;
    }
  });

  // GET /api/v1/residents/:id
  app.get('/:id', { schema: getResidentSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await db.query(
      `SELECT id, name, phone,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              created_at
       FROM residents WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Resident not found' });
    return rows[0];
  });
}
