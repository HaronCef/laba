// Обгортка над WebSocket:
//  - повідомлення від сервера розсилає як події за їхнім type ('roster', 'chat', ...);
//  - send() до підключення складає повідомлення в чергу і відправляє після open;
//  - якщо з'єднання обірвалось, підключається знову з дедалі довшою паузою.
// Події самої обгортки: 'open', 'status' (detail.status, detail.code)

const VERSION = 0;
const MAX_QUEUE = 50;

// з такими кодами сервер закрив нас за нашу помилку - повтор нічого не дасть
const NO_RETRY_CODES = [1000, 4000, 4001, 4002, 4003, 4004, 4005];

export class Connection extends EventTarget {
  #ws = null;
  #queue = [];
  #attempt = 0;
  #timer = 0;
  #stopped = false;

  constructor(url) {
    super();
    this.url = url;
    this.status = 'connecting';
    this.#connect();
  }

  #setStatus(status, code) {
    this.status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: { status, code } }));
  }

  #connect() {
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    this.#ws = ws;

    ws.onopen = () => {
      this.#attempt = 0;
      this.#setStatus('open');
      this.dispatchEvent(new CustomEvent('open'));
      // усе, що накопичилось, поки не було з'єднання
      for (const data of this.#queue) ws.send(data);
      this.#queue = [];
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn('[net] сервер надіслав не JSON', event.data);
        return;
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };

    ws.onclose = (event) => {
      if (this.#stopped || NO_RETRY_CODES.includes(event.code)) {
        this.#setStatus('closed', event.code);
        return;
      }
      // 0.5 с, 1 с, 2 с, 4 с ... але не більше 10 с, плюс випадкова добавка
      const delay = Math.min(10000, 500 * 2 ** this.#attempt) + Math.random() * 300;
      this.#attempt++;
      this.#setStatus('waiting', event.code);
      console.log(
        `[net] з'єднання закрито (${event.code}), ще раз через ${Math.round(delay)} мс`,
      );
      this.#timer = setTimeout(() => this.#connect(), delay);
    };
  }

  send(type, fields = {}) {
    const data = JSON.stringify({ v: VERSION, type, ...fields });
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(data);
    } else if (this.#queue.length < MAX_QUEUE) {
      this.#queue.push(data);
    }
  }

  close() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#ws?.close(1000, 'bye');
  }
}

export function serverUrl() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}/ws`;
}
