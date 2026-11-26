import { z } from 'zod';
import { RoomInfoSchema, type RoomInfo } from 'shared/protocol.ts';
import { fetchJson } from '../assets/loader.ts';
import { Bus } from '../bus.ts';

// Дані лобі без DOM. Сповіщає про зміни подіями (типізована шина замість EventTarget).
export type LobbyEvents = {
  rooms: readonly RoomInfo[]; // прийшов новий список кімнат
  error: unknown; // запит не вдався
  join: { room: RoomInfo; name: string }; // гравець увійшов у кімнату
  created: RoomInfo; // створили нову кімнату
};

// відповідь сервера - теж вхід ззовні: перевіряємо схемою зі shared/protocol.ts
const RoomListSchema = z.array(RoomInfoSchema);
const CreateErrorSchema = z.object({ error: z.string() });

export class Lobby extends Bus<LobbyEvents> {
  // У JS тут було null до start(), і refresh() до start() падав на this.#controller.signal.
  // TypeScript показав "possibly null" - тепер контролер є з самого початку.
  #controller = new AbortController();
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly url: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  rooms: readonly RoomInfo[] = [];

  constructor(url: string, { intervalMs = 3000, timeoutMs = 2000 } = {}) {
    super();
    this.url = url;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
  }

  start(): void {
    this.#controller = new AbortController();
    void this.refresh();
    // стрілка, щоб усередині refresh this був лобі (баг з лаби 2)
    this.#timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#controller.abort();
  }

  async refresh(): Promise<void> {
    // кожен запит має свій таймаут + загальний abort при виході з лобі
    const signal = AbortSignal.any([
      this.#controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    try {
      this.rooms = RoomListSchema.parse(await fetchJson(this.url, { signal }));
      this.emit('rooms', this.rooms);
    } catch (err: unknown) {
      if (this.#controller.signal.aborted) return; // ми самі пішли з лобі - це не помилка
      this.emit('error', err);
    }
  }

  // POST /api/rooms - нова кімната на сервері
  async create(name: string): Promise<RoomInfo> {
    const response = await fetch(this.url.split('?')[0] ?? this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, maxPlayers: 4 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = CreateErrorSchema.safeParse(data);
      throw new Error(error.success ? error.data.error : `HTTP ${response.status}`);
    }
    const room = RoomInfoSchema.parse(data);
    this.emit('created', room);
    await this.refresh();
    return room;
  }

  join(roomId: string, name: string): void {
    const room = this.rooms.find((r) => r.id === roomId); // find може повернути undefined
    if (!room) return;
    this.stop();
    this.emit('join', { room, name });
  }
}
