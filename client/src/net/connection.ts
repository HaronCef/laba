import { Bus } from '../bus.ts';
import {
  clientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type WithoutVersion,
} from 'shared/protocol.ts';

// Обгортка над WebSocket:
//  - текстові повідомлення сервера перевіряє Zod-схемою і розсилає як події за їхнім type;
//    бінарні (знімки) - подією 'binary' з ArrayBuffer;
//  - send() до підключення складає повідомлення в чергу і відправляє після open;
//    sendNow() шле лише якщо з'єднання є (input не має сенсу відправляти пізніше);
//  - якщо з'єднання обірвалось, підключається знову з дедалі довшою паузою;
//  - рахує байти туди й назад (для netgraph).

export type ConnectionStatus = 'connecting' | 'reconnecting' | 'waiting' | 'open' | 'closed';

// З union повідомлень сервера робимо "карту подій": { joined: JoinedMsg; roster: RosterMsg; ... }
type ServerEvents = { [M in ServerMessage as M['type']]: M };

export type ConnectionEvents = ServerEvents & {
  status: { status: ConnectionStatus; code?: number };
  open: undefined;
  binary: ArrayBuffer;
};

const MAX_QUEUE = 50;

// з такими кодами сервер закрив нас за нашу помилку - повтор нічого не дасть
const NO_RETRY_CODES = new Set([1000, 4000, 4001, 4002, 4003, 4004, 4005]);

const encoder = new TextEncoder();

export class Connection extends Bus<ConnectionEvents> {
  #ws: WebSocket | null = null;
  #queue: string[] = [];
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  readonly url: string;
  status: ConnectionStatus = 'connecting';
  bytesIn = 0;
  bytesOut = 0;

  constructor(url: string) {
    super();
    this.url = url;
    this.#connect();
  }

  #setStatus(status: ConnectionStatus, code?: number): void {
    this.status = status;
    this.emit('status', code === undefined ? { status } : { status, code });
  }

  #connect(): void {
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer'; // знімки приходять як ArrayBuffer
    this.#ws = ws;

    ws.onopen = () => {
      this.#attempt = 0;
      this.#setStatus('open');
      this.emit('open', undefined);
      // усе, що накопичилось, поки не було з'єднання
      for (const data of this.#queue) this.#rawSend(ws, data);
      this.#queue = [];
    };

    ws.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        this.bytesIn += data.byteLength;
        this.emit('binary', data);
        return;
      }
      if (typeof data === 'string') this.bytesIn += encoder.encode(data).length;
      // типи після збірки зникають: що прислав сервер, перевіряє схема
      const parsed = parseServerMessage(data);
      if (!parsed.ok) {
        console.warn('[net] незрозуміле повідомлення від сервера:', parsed.error);
        return;
      }
      this.emit(parsed.value.type, parsed.value);
    };

    ws.onclose = (event) => {
      if (this.#stopped || NO_RETRY_CODES.has(event.code)) {
        this.#setStatus('closed', event.code);
        return;
      }
      // 0.5 с, 1 с, 2 с, 4 с ... але не більше 10 с, плюс випадкова добавка
      const delay = Math.min(10000, 500 * 2 ** this.#attempt) + Math.random() * 300;
      this.#attempt++;
      this.#setStatus('waiting', event.code);
      console.log(`[net] з'єднання закрито (${event.code}), ще раз через ${Math.round(delay)} мс`);
      this.#timer = setTimeout(() => this.#connect(), delay);
    };
  }

  #rawSend(ws: WebSocket, data: string | ArrayBuffer): void {
    this.bytesOut += typeof data === 'string' ? encoder.encode(data).length : data.byteLength;
    ws.send(data);
  }

  get isOpen(): boolean {
    return this.#ws !== null && this.#ws.readyState === WebSocket.OPEN;
  }

  // JSON-повідомлення протоколу (тип перевіряє, що поля правильні); поки немає з'єднання - у чергу
  send(msg: WithoutVersion<ClientMessage>): void {
    const data = clientMessage(msg);
    if (this.#ws && this.isOpen) {
      this.#rawSend(this.#ws, data);
    } else if (this.#queue.length < MAX_QUEUE) {
      this.#queue.push(data);
    }
  }

  // готові дані (рядок або ArrayBuffer) - лише якщо з'єднання є зараз
  sendNow(data: string | ArrayBuffer): void {
    if (this.#ws && this.isOpen) this.#rawSend(this.#ws, data);
  }

  close(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#ws?.close(1000, 'bye');
  }
}

export function serverUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}/ws`;
}
