import { fetchJson } from '../assets/loader.js';

// Дані лобі без DOM. Сповіщає про зміни подіями:
//   "rooms"  - прийшов новий список кімнат (detail.rooms)
//   "error"  - запит не вдався (detail.error)
//   "join"   - гравець увійшов у кімнату (detail.room, detail.name)
//   "created" - створили нову кімнату (detail.room)
export class Lobby extends EventTarget {
  #controller = null; // скасовує всі запити лобі, коли гравець пішов
  #timer = 0;

  constructor(url, { intervalMs = 3000, timeoutMs = 2000 } = {}) {
    super();
    this.url = url;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.rooms = [];
  }

  start() {
    this.#controller = new AbortController();
    this.refresh();
    // стрілка, щоб усередині refresh this був лобі (баг з лаби 2)
    this.#timer = setInterval(() => this.refresh(), this.intervalMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#controller?.abort();
  }

  async refresh() {
    // кожен запит має свій таймаут + загальний abort при виході з лобі
    const signal = AbortSignal.any([
      this.#controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    try {
      this.rooms = await fetchJson(this.url, { signal });
      this.dispatchEvent(new CustomEvent('rooms', { detail: { rooms: this.rooms } }));
    } catch (err) {
      if (this.#controller.signal.aborted) return; // ми самі пішли з лобі - це не помилка
      this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
    }
  }

  // POST /api/rooms - нова кімната на сервері
  async create(name) {
    const response = await fetch(this.url.split('?')[0], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, maxPlayers: 4 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    this.dispatchEvent(new CustomEvent('created', { detail: { room: data } }));
    await this.refresh();
    return data;
  }

  join(roomId, name) {
    const room = this.rooms.find((r) => r.id === roomId);
    if (!room) return;
    this.stop();
    this.dispatchEvent(new CustomEvent('join', { detail: { room, name } }));
  }
}
