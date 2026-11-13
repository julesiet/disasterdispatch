import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { residentsRoutes } from './routes/residents.js';
import { driversRoutes } from './routes/drivers.js';
import { driverViewRoutes } from './routes/driver-view.js';
import { smsWebhookRoutes } from './routes/sms-webhook.js';
import { transportQueueRoutes } from './routes/admin/transport-queue.js';
import { adminOverviewRoutes } from './routes/admin/overview.js';
import { dangerZonesRoutes, startFirmsPoller } from './services/firms-sync.js';
import { MockSmsService } from './services/sms.js';
import { startAlertEngine } from './services/alert-engine.js';
import { heatmapRoutes } from './routes/heatmap.js';
import { broadcastKeepAlive } from './services/sse-broadcaster.js';
const root = process.env['npm_config_local_prefix'] ?? resolve(process.cwd(), '..', '..');
dotenv.config({ path: resolve(root, '.env') });
export async function buildApp() {
    const app = Fastify({ logger: true });
    await app.register(cors, {
        origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    });
    // Register SMS service (swap MockSmsService for TwilioSmsService here later)
    const sms = new MockSmsService();
    app.decorate('sms', sms);
    // Health check
    app.get('/health', async () => ({ status: 'ok' }));
    // API v1 routes
    await app.register(residentsRoutes, { prefix: '/api/v1/residents' });
    await app.register(driversRoutes, { prefix: '/api/v1/drivers' });
    await app.register(driverViewRoutes, { prefix: '/api/v1/driver-view' });
    await app.register(dangerZonesRoutes, { prefix: '/api/v1/admin/danger-zones' });
    await app.register(transportQueueRoutes, { prefix: '/api/v1/admin/transport-requests' });
    await app.register(adminOverviewRoutes, { prefix: '/api/v1/admin/overview' });
    await app.register(smsWebhookRoutes, { prefix: '/webhooks/sms-inbound' });
    await app.register(heatmapRoutes, { prefix: '/api/v1/heatmap' });
    // Start engines after server is ready
    app.addHook('onReady', async () => {
        startAlertEngine(sms);
        startFirmsPoller();
        // SSE keep-alive ping every 30 seconds
        setInterval(broadcastKeepAlive, 30_000);
    });
    return app;
}
//# sourceMappingURL=app.js.map