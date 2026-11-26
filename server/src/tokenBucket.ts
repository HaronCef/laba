// Token bucket: у відрі size жетонів, за секунду додається refill.
// Кожне повідомлення забирає жетон. Немає жетонів - відмова.
export class TokenBucket {
  readonly size: number;
  readonly refill: number;
  #tokens: number;
  #last: number;

  constructor(size: number, refill: number, now = Date.now()) {
    this.size = size;
    this.refill = refill;
    this.#tokens = size;
    this.#last = now;
  }

  take(now = Date.now()): boolean {
    this.#tokens = Math.min(this.size, this.#tokens + ((now - this.#last) / 1000) * this.refill);
    this.#last = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }

  get tokens(): number {
    return this.#tokens;
  }
}
