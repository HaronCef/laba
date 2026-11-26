// Heartbeat: раз на intervalMs шлемо ping. Хто не відповів maxMissed разів - відключаємо.
export interface HeartbeatClient {
  missedPongs: number; // скидається в 0, коли приходить pong
  readonly socket: { ping(): void; terminate(): void };
}

export function startHeartbeat(
  clients: () => Iterable<HeartbeatClient>,
  { intervalMs, maxMissed }: { intervalMs: number; maxMissed: number },
): () => void {
  const timer = setInterval(() => {
    for (const client of clients()) {
      if (client.missedPongs >= maxMissed) {
        client.socket.terminate();
        continue;
      }
      client.missedPongs++;
      client.socket.ping();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
