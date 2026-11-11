import { db } from '../db.js';
const phonePattern = '^\\+[1-9]\\d{1,14}$';
const createDriverSchema = {
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
};
const getDriverSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
    },
};
const patchAvailabilitySchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
    },
    body: {
        type: 'object',
        required: ['available'],
        properties: { available: { type: 'boolean' } },
        additionalProperties: false,
    },
};
export async function driversRoutes(app) {
    // POST /api/v1/drivers
    app.post('/', { schema: createDriverSchema }, async (request, reply) => {
        const { name, phone, lat, lng } = request.body;
        try {
            const { rows } = await db.query(`INSERT INTO drivers (name, phone, service_area)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         RETURNING id, name, phone, available, created_at`, [name, phone, lng, lat]);
            return reply.status(201).send(rows[0]);
        }
        catch (err) {
            const pg = err;
            if (pg.code === '23505') {
                return reply.status(409).send({ error: 'Phone number already registered' });
            }
            throw err;
        }
    });
    // GET /api/v1/drivers/:id
    app.get('/:id', { schema: getDriverSchema }, async (request, reply) => {
        const { id } = request.params;
        const { rows } = await db.query(`SELECT id, name, phone, available,
              ST_Y(service_area::geometry) AS lat,
              ST_X(service_area::geometry) AS lng,
              created_at
       FROM drivers WHERE id = $1`, [id]);
        if (rows.length === 0)
            return reply.status(404).send({ error: 'Driver not found' });
        return rows[0];
    });
    // PATCH /api/v1/drivers/:id/availability
    app.patch('/:id/availability', { schema: patchAvailabilitySchema }, async (request, reply) => {
        const { id } = request.params;
        const { available } = request.body;
        const { rows } = await db.query(`UPDATE drivers SET available = $1 WHERE id = $2
       RETURNING id, name, phone, available`, [available, id]);
        if (rows.length === 0)
            return reply.status(404).send({ error: 'Driver not found' });
        return rows[0];
    });
}
//# sourceMappingURL=drivers.js.map