import type { FastifyReply } from 'fastify';
type SseClient = FastifyReply['raw'];
export declare function addSseClient(raw: SseClient): void;
export declare function broadcast(event: string, data: unknown): void;
export declare function broadcastKeepAlive(): void;
export {};
//# sourceMappingURL=sse-broadcaster.d.ts.map