// Мітки performance.mark/measure для DevTools (доріжка Timings).
// Вмикаються через ?perf=1, бо кожна мітка - новий об'єкт.

export const perfOn = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

export function mark(name: string): void {
  if (perfOn) performance.mark(name);
}

export function measure(name: string, startMark: string): void {
  if (perfOn) performance.measure(name, startMark);
}
