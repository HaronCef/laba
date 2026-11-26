import { performance } from 'node:perf_hooks';

// Лічильники для /metrics. Їх збільшує ws.ts, а раз на секунду рахуємо "за секунду".
export const counters = {
  messagesIn: 0,
  bytesIn: 0,
  bytesOut: 0,
};

// скільки з'єднань відхилили або закрили і чому (origin, ip-limit, rate-limit, bad-message ...)
export const rejections: Record<string, number> = {};

export function reject(reason: string): void {
  rejections[reason] = (rejections[reason] ?? 0) + 1;
}

export const perSecond = { messagesIn: 0, bytesIn: 0, bytesOut: 0 };
export let elu = 0; // зайнятість циклу подій за останню секунду (0..1)

let last = { ...counters };
let lastElu = performance.eventLoopUtilization();

const timer = setInterval(() => {
  perSecond.messagesIn = counters.messagesIn - last.messagesIn;
  perSecond.bytesIn = counters.bytesIn - last.bytesIn;
  perSecond.bytesOut = counters.bytesOut - last.bytesOut;
  last = { ...counters };
  const now = performance.eventLoopUtilization();
  elu = performance.eventLoopUtilization(now, lastElu).utilization;
  lastElu = now;
}, 1000);
timer.unref(); // через цей таймер процес не повинен "висіти" при вимкненні

// код закриття -> назва причини для rejections
export function reasonOf(code: number): string {
  switch (code) {
    case 4000:
      return 'bad-message';
    case 4001:
      return 'unknown-type';
    case 4002:
      return 'bad-version';
    case 4003:
      return 'join-timeout';
    case 4004:
      return 'rate-limit';
    case 4005:
      return 'room-unavailable';
    case 4006:
      return 'slow-client';
    case 4007:
      return 'no-heartbeat';
    default:
      return `code-${code}`;
  }
}
