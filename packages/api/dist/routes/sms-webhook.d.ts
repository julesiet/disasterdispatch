import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SmsService } from '../services/sms.js';
export declare function smsWebhookRoutes(app: FastifyInstance): Promise<void>;
declare module 'fastify' {
    interface FastifyInstance {
        sms: SmsService;
    }
}
export type { FastifyReply };
//# sourceMappingURL=sms-webhook.d.ts.map