import type { FastifyReply } from 'fastify';

type SseClient = FastifyReply['raw'];

const clients = new Set<SseClient>();

export function addSseClient(raw: SseClient): void {
  clients.add(raw);
  raw.on('close', () => clients.delete(raw));
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function broadcastKeepAlive(): void {
  for (const client of clients) {
    try {
      client.write(': ping\n\n');
    } catch {
      clients.delete(client);
    }
  }
}
