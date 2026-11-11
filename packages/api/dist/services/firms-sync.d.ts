import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
export declare const zoneEvents: EventEmitter<[never]>;
export type ZoneChangedPayload = {
    id: string;
    severity: 'approaching' | 'imminent';
    active: boolean;
};
export declare function syncFirms(): Promise<void>;
export declare function startFirmsPoller(intervalMs?: number): void;
export declare function dangerZonesRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=firms-sync.d.ts.map