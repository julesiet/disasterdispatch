import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { residentsRoutes } from './routes/residents.js';
import { driversRoutes } from './routes/drivers.js';
import { dangerZonesRoutes, startFirmsPoller } from './services/firms-sync.js';
const root = process.env['npm_config_local_prefix'] ?? resolve(process.cwd(), '..', '..');
dotenv.config({ path: resolve(root, '.env') });
export async function buildApp() {
    const app = Fastify({ logger: true });
    await app.register(cors, {
        origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    });
    // Health check
    app.get('/health', async () => ({ status: 'ok' }));
    // API v1 routes
    await app.register(residentsRoutes, { prefix: '/api/v1/residents' });
    await app.register(driversRoutes, { prefix: '/api/v1/drivers' });
    await app.register(dangerZonesRoutes, { prefix: '/api/v1/admin/danger-zones' });
    // Start NASA FIRMS poller after server is ready
    app.addHook('onReady', async () => {
        startFirmsPoller();
    });
    return app;
}
//# sourceMappingURL=app.js.map