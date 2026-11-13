const clients = new Set();
export function addSseClient(raw) {
    clients.add(raw);
    raw.on('close', () => clients.delete(raw));
}
export function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
        try {
            client.write(payload);
        }
        catch {
            clients.delete(client);
        }
    }
}
export function broadcastKeepAlive() {
    for (const client of clients) {
        try {
            client.write(': ping\n\n');
        }
        catch {
            clients.delete(client);
        }
    }
}
//# sourceMappingURL=sse-broadcaster.js.map