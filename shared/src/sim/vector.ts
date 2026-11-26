// кут у межах [-PI, PI)
export function normalizeAngle(angle: number): number {
  const full = Math.PI * 2;
  return angle - full * Math.floor((angle + Math.PI) / full);
}

// 2D-вектор. Поля readonly, а всі методи повертають новий вектор:
// старий ніхто не може змінити, тому його безпечно ділити між об'єктами.
export class Vector2 {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  static fromAngle(angle: number, length = 1): Vector2 {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  add(other: Vector2): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vector2): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(k: number): Vector2 {
    return new Vector2(this.x * k, this.y * k);
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  normalize(): Vector2 {
    const len = this.length();
    if (len === 0) return new Vector2(0, 0);
    return new Vector2(this.x / len, this.y / len);
  }

  rotate(angle: number): Vector2 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  dot(other: Vector2): number {
    return this.x * other.x + this.y * other.y;
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  distanceTo(other: Vector2): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}
