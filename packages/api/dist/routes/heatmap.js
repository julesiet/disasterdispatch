import { db } from '../db.js';
import { addSseClient, broadcast } from '../services/sse-broadcaster.js';
const GRID_DEG = Number(process.env['HEATMAP_GRID_DEGREES'] ?? 0.01);
async function getHeatmapPayload() {
    const [zonesResult, gridResult] = await Promise.all([
        db.query(`
      SELECT id, source, severity,
             ST_AsGeoJSON(zone::geometry)::json AS geometry
      FROM danger_zones WHERE active = true
    `),
        db.query(`
      WITH resident_status AS (
        SELECT r.id, r.location,
          EXISTS (
            SELECT 1 FROM transport_requests tr
            WHERE tr.resident_id = r.id AND tr.status = 'completed'
          ) AS helped,
          EXISTS (
            SELECT 1 FROM transport_requests tr
            WHERE tr.resident_id = r.id AND tr.status IN ('waiting', 'assigned')
          ) AS waiting,
          EXISTS (
            SELECT 1 FROM alerts a
            JOIN danger_zones dz ON dz.id = a.danger_zone_id AND dz.active = true
            WHERE a.resident_id = r.id AND a.response IS NULL
          ) AND NOT EXISTS (
            SELECT 1 FROM transport_requests tr WHERE tr.resident_id = r.id
          ) AS at_risk
        FROM residents r
      )
      SELECT
        ST_X(ST_SnapToGrid(location::geometry, $1)) AS cell_lng,
        ST_Y(ST_SnapToGrid(location::geometry, $1)) AS cell_lat,
        COUNT(*) FILTER (WHERE helped AND NOT waiting)::int AS helped,
        COUNT(*) FILTER (WHERE waiting)::int AS waiting,
        COUNT(*) FILTER (WHERE at_risk)::int AS at_risk
      FROM resident_status
      GROUP BY cell_lng, cell_lat
    `, [GRID_DEG]),
    ]);
    const zones = {
        type: 'FeatureCollection',
        features: zonesResult.rows.map((z) => ({
            type: 'Feature',
            properties: { id: z.id, source: z.source, severity: z.severity },
            geometry: z.geometry,
        })),
    };
    const grid = {
        type: 'FeatureCollection',
        features: gridResult.rows.map((row) => {
            const half = GRID_DEG / 2;
            return {
                type: 'Feature',
                properties: {
                    helped: row.helped,
                    waiting: row.waiting,
                    at_risk: row.at_risk,
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [row.cell_lng - half, row.cell_lat - half],
                            [row.cell_lng + half, row.cell_lat - half],
                            [row.cell_lng + half, row.cell_lat + half],
                            [row.cell_lng - half, row.cell_lat + half],
                            [row.cell_lng - half, row.cell_lat - half],
                        ],
                    ],
                },
            };
        }),
    };
    return { zones, grid };
}
export async function heatmapRoutes(app) {
    // GET /api/v1/heatmap/zones
    app.get('/zones', async () => {
        const { rows } = await db.query(`
      SELECT id, source, severity,
             ST_AsGeoJSON(zone::geometry)::json AS geometry
      FROM danger_zones WHERE active = true
    `);
        return {
            type: 'FeatureCollection',
            features: rows.map((z) => ({
                type: 'Feature',
                properties: { id: z.id, source: z.source, severity: z.severity },
                geometry: z.geometry,
            })),
        };
    });
    // GET /api/v1/heatmap/grid
    app.get('/grid', async () => {
        const payload = await getHeatmapPayload();
        return payload.grid;
    });
    // GET /api/v1/heatmap/stream  (SSE)
    app.get('/stream', async (_request, reply) => {
        const payload = await getHeatmapPayload();
        // Tell Fastify this handler owns the raw response stream.
        reply.hijack();
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
        });
        addSseClient(reply.raw);
        // Send current state immediately on connect
        reply.raw.write(`event: heatmap-update\ndata: ${JSON.stringify(payload)}\n\n`);
        // The broadcaster removes this client when the response closes. Do not
        // listen to IncomingMessage 'close': it can fire after the request body is
        // consumed, even though the long-lived response is still connected.
    });
}
export async function pushHeatmapUpdate() {
    try {
        const payload = await getHeatmapPayload();
        broadcast('heatmap-update', payload);
    }
    catch (err) {
        console.error('[sse] Failed to push heatmap update:', err);
    }
}
//# sourceMappingURL=heatmap.js.map