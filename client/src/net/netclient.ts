import { stepShip, shotId, type ShipState } from 'shared/sim/ship.ts';
import { TICK_MS } from 'shared/sim/constants.ts';
import { ARENA, wrapValue } from 'shared/sim/arena.ts';
import { normalizeAngle } from 'shared/sim/vector.ts';
import {
  binaryCodec,
  pickCodec,
  type Codec,
  type CodecName,
} from 'shared/codec/index.ts';
import { asSeq, assertNever, type EntityId, type Seq, type Tick } from 'shared/types.ts';
import type {
  EntityRecord,
  GameEvent,
  Input,
  ServerMessage,
  ShipRecord,
  Snapshot,
} from 'shared/protocol.ts';
import { Bus } from '../bus.ts';
import type { Connection } from './connection.ts';
import type { Drawable } from '../render/drawable.ts';

// Мережева частина гри на клієнті:
//  - шле input з seq кожен крок (30/с);
//  - прогнозує свій корабель тією ж функцією stepShip, що й сервер;
//  - коли приходить знімок: ставить корабель у стан сервера і заново програє
//    ще не підтверджені input (reconciliation), різницю згладжує ~100 мс;
//  - чужі сутності малює трохи в минулому, між двома знімками (interpolation);
//  - свої кулі показує одразу, а потім звіряє з кулями сервера за shotId.

const SMOOTH_MS = 35; // постійна часу згладжування: за ~100 мс від поправки лишається ~5%
const SNAP_DISTANCE = 150; // більша поправка (респаун) - без згладжування, одразу
const BULLET_TTL_MS = 1200;

type JoinedMessage = Extract<ServerMessage, { type: 'joined' }>;

// події NetClient: усі події гри за їхнім type + 'joined'
export type NetEvents = { [E in GameEvent as E['type']]: E } & { joined: JoinedMessage };

export type Controls = Omit<Input, 'seq'>;

interface StoredSnapshot {
  readonly tick: Tick;
  readonly ack: Seq;
  readonly entities: ReadonlyMap<EntityId, EntityRecord>;
  readonly arrival: number;
}

interface LocalBullet {
  readonly key: number; // shotId
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly born: number;
  confirmed: boolean;
}

// різниця з урахуванням "загортання" країв: шлях через край, якщо він коротший
function wrappedDelta(d: number, size: number): number {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

function lerpWrapped(a: number, b: number, t: number, size: number): number {
  return wrapValue(a + wrappedDelta(b - a, size) * t, size);
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

function shipState(r: ShipRecord): ShipState {
  return {
    x: r.x,
    y: r.y,
    vx: r.vx,
    vy: r.vy,
    angle: r.angle,
    shotCd: r.shotCd,
    missileCd: r.missileCd,
    triple: r.triple,
  };
}

export class NetClient extends Bus<NetEvents> {
  readonly connection: Connection;
  readonly codec: Codec;
  predict = true;
  interpDelay: number; // мс, на скільки в минулому малюємо чужих

  shipId: EntityId | null = null;
  seed = 0;
  #seq = 0;
  pending: Input[] = []; // input, які сервер ще не підтвердив
  #snapshots: StoredSnapshot[] = [];
  latest: StoredSnapshot | null = null;
  me: ShipRecord | null = null; // мій корабель з останнього знімка

  #predicted: ShipState | null = null; // прогнозований стан мого корабля
  #prevPredicted: ShipState | null = null; // стан на попередньому кроці (для плавного малювання)
  #lastThrust = false;
  #offset = { x: 0, y: 0 }; // згладжування поправки
  #localBullets: LocalBullet[] = [];

  #clockOffset = 0; // час сервера (tick * 33.3 мс) мінус performance.now()
  #clockKnown = false;
  rtt = 0;
  corrections: number[] = []; // величина поправки на кожен знімок (останні 90)
  lastCorrection = 0;
  readonly #pingTimer: ReturnType<typeof setInterval>;

  constructor(
    connection: Connection,
    {
      codec = 'binary',
      interpDelay = 100,
    }: { codec?: CodecName; interpDelay?: number } = {},
  ) {
    super();
    this.connection = connection;
    this.codec = pickCodec(codec);
    this.interpDelay = interpDelay;

    connection.on('joined', (msg) => this.#onJoined(msg));
    connection.on('binary', (data) =>
      this.#onSnapshotResult(binaryCodec.decodeSnapshot(data)),
    );
    connection.on('snapshot', (msg) => this.#onSnapshot(msg)); // JSON-кодек: уже перевірено Zod
    connection.on('pong', (msg) => {
      this.rtt = performance.now() - msg.t;
    });
    connection.on('events', (msg) => this.#onEvents(msg.list));

    this.#pingTimer = setInterval(
      () => connection.send({ type: 'ping', t: performance.now() }),
      1000,
    );
  }

  // при кожному (пере)підключенні сервер створює новий корабель
  #onJoined(msg: JoinedMessage): void {
    this.shipId = msg.shipId;
    this.seed = msg.seed;
    this.pending = [];
    this.#snapshots = [];
    this.latest = null;
    this.me = null;
    this.#predicted = null;
    this.#prevPredicted = null;
    this.#localBullets = [];
    this.#clockKnown = false;
    this.emit('joined', msg);
  }

  get isDead(): boolean {
    return this.me?.dead ?? false;
  }

  // ---------- input ----------

  // викликається з simulate() кожен крок (1/30 с)
  sendInput(controls: Controls, now = performance.now()): void {
    if (this.shipId === null) return;
    const input: Input = { seq: asSeq(++this.#seq), ...controls };
    this.connection.sendNow(this.codec.encodeInput(input));

    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift(); // сервер давно не відповідає

    this.#prevPredicted = this.#predicted;
    this.#lastThrust = controls.thrust;
    if (!this.predict || !this.#predicted || this.isDead) return;

    // прогноз: та сама функція, що на сервері
    const { state, shots } = stepShip(this.#predicted, input);
    this.#predicted = state;

    for (const shot of shots) {
      if (shot.missile) continue; // ракета наводиться сама - її показуємо лише з сервера
      this.#localBullets.push({
        ...shot,
        key: shotId(input.seq, shot.index),
        born: now,
        confirmed: false,
      });
    }
    const first = shots[0];
    if (first) {
      this.emit('fired', {
        type: 'fired',
        ship: this.shipId,
        missile: first.missile,
        x: state.x,
        y: state.y,
      });
    }
  }

  // ---------- знімки ----------

  #onSnapshotResult(result: ReturnType<Codec['decodeSnapshot']>): void {
    if (result.ok) this.#onSnapshot(result.value);
    else console.warn('[net] битий знімок:', result.error);
  }

  #onSnapshot(snap: Snapshot): void {
    if (this.latest && snap.tick <= this.latest.tick) return; // запізнився - вже є новіший

    const now = performance.now();
    const s: StoredSnapshot = {
      tick: snap.tick,
      ack: snap.ack,
      entities: new Map(snap.entities.map((e) => [e.id, e])),
      arrival: now,
    };
    this.#snapshots.push(s);
    if (this.#snapshots.length > 60) this.#snapshots.shift();
    this.latest = s;

    // оцінка "годинника сервера": знімок tick був створений приблизно в tick * 33.3 мс
    const sample = s.tick * TICK_MS - now;
    if (!this.#clockKnown || Math.abs(sample - this.#clockOffset) > 1000) {
      this.#clockOffset = sample;
      this.#clockKnown = true;
    } else {
      this.#clockOffset += (sample - this.#clockOffset) * 0.1;
    }

    this.#reconcile(s);
    this.#checkLocalBullets(s, now);
  }

  #reconcile(s: StoredSnapshot): void {
    if (this.shipId === null) return;
    const record = s.entities.get(this.shipId); // Map.get: мого корабля в знімку може не бути
    if (!record || record.kind !== 'ship') return;
    this.me = record;

    // усе, що сервер уже застосував, з буфера викидаємо
    this.pending = this.pending.filter((input) => input.seq > s.ack);
    const server = shipState(record);

    if (!this.predict || record.dead || !this.#predicted) {
      this.#predicted = server;
      this.#prevPredicted = server;
      this.#offset = { x: 0, y: 0 };
      return;
    }

    // стан сервера + ще не підтверджені input = де корабель має бути зараз
    let state = server;
    for (const input of this.pending) state = stepShip(state, input).state;

    const dx = wrappedDelta(state.x - this.#predicted.x, ARENA.width);
    const dy = wrappedDelta(state.y - this.#predicted.y, ARENA.height);
    const correction = Math.hypot(dx, dy);
    this.lastCorrection = correction;
    this.corrections.push(correction);
    if (this.corrections.length > 90) this.corrections.shift();

    if (correction > SNAP_DISTANCE) {
      this.#offset = { x: 0, y: 0 }; // респаун або великий стрибок - без згладжування
      this.#prevPredicted = state;
    } else {
      // корабель одразу в правильному місці, але на екрані компенсуємо різницю,
      // а потім ця компенсація плавно зникає
      this.#offset.x -= dx;
      this.#offset.y -= dy;
      const prev = this.#prevPredicted;
      if (prev) {
        this.#prevPredicted = {
          ...prev,
          x: wrapValue(prev.x + dx, ARENA.width),
          y: wrapValue(prev.y + dy, ARENA.height),
        };
      }
    }
    this.#predicted = state;
  }

  #checkLocalBullets(s: StoredSnapshot, now: number): void {
    const serverKeys = new Set<number>();
    for (const e of s.entities.values()) {
      if (e.kind === 'bullet' && e.owner === this.shipId && !e.missile)
        serverKeys.add(e.shotId);
    }
    this.#localBullets = this.#localBullets.filter((b) => {
      if (serverKeys.has(b.key)) {
        b.confirmed = true; // сервер теж створив цю кулю
        return true;
      }
      if (b.confirmed) return false; // була на сервері, а тепер нема - у щось влучила
      return now - b.born < this.rtt + 300; // сервер її так і не створив
    });
  }

  #onEvents(list: readonly GameEvent[]): void {
    for (const event of list) {
      // свій постріл ми вже озвучили під час прогнозу
      if (event.type === 'fired' && event.ship === this.shipId && this.predict) continue;
      this.#emitGameEvent(event);
    }
  }

  // emit з union подій: switch по type з never у default
  #emitGameEvent(event: GameEvent): void {
    switch (event.type) {
      case 'fired':
        return this.emit('fired', event);
      case 'hit':
        return this.emit('hit', event);
      case 'exploded':
        return this.emit('exploded', event);
      case 'pickup':
        return this.emit('pickup', event);
      case 'score':
        return this.emit('score', event);
      default:
        assertNever(event);
    }
  }

  // ---------- що малювати ----------

  // frameDt - секунди з попереднього кадру, alpha - частка кроку (з loop)
  renderList(alpha: number, frameDt: number, now = performance.now()): Drawable[] {
    const list: Drawable[] = [];
    if (!this.latest) return list;

    // згладжування поправки згасає
    const k = Math.exp((-frameDt * 1000) / SMOOTH_MS);
    this.#offset.x *= k;
    this.#offset.y *= k;

    // свої кулі летять самі по собі
    for (const b of this.#localBullets) {
      b.x = wrapValue(b.x + b.vx * frameDt, ARENA.width);
      b.y = wrapValue(b.y + b.vy * frameDt, ARENA.height);
    }
    this.#localBullets = this.#localBullets.filter((b) => now - b.born < BULLET_TTL_MS);
    const localKeys = new Set(this.#localBullets.map((b) => b.key));
    for (const b of this.#localBullets)
      list.push({ kind: 'bullet', x: b.x, y: b.y, angle: b.angle, missile: false });

    // чужі сутності - в минулому, між двома знімками
    for (const { from, to, t } of this.#interpolationPairs(now)) {
      if (to.kind === 'ship' && to.id === this.shipId) continue;
      if (to.kind === 'bullet' && to.owner === this.shipId && localKeys.has(to.shotId))
        continue;
      list.push(this.#toDrawable(from, to, t));
    }

    // мій корабель без прогнозу: просто останній знімок (рухається лише коли знімок прийшов)
    if (!this.predict && this.me && !this.me.dead) {
      list.push(this.#toDrawable(this.me, this.me, 1));
    }

    // мій корабель з прогнозом
    const cur = this.#predicted;
    if (this.predict && cur && this.me && this.shipId !== null && !this.me.dead) {
      const prev = this.#prevPredicted ?? cur;
      list.push({
        kind: 'ship',
        id: this.shipId,
        mine: true,
        dead: false,
        x: wrapValue(
          lerpWrapped(prev.x, cur.x, alpha, ARENA.width) + this.#offset.x,
          ARENA.width,
        ),
        y: wrapValue(
          lerpWrapped(prev.y, cur.y, alpha, ARENA.height) + this.#offset.y,
          ARENA.height,
        ),
        angle: lerpAngle(prev.angle, cur.angle, alpha),
        thrust: this.#lastThrust,
        shield: this.me.shield,
      });
    }
    return list;
  }

  // знаходимо два знімки навколо часу "зараз мінус interpDelay"
  #interpolationPairs(
    now: number,
  ): Array<{ from: EntityRecord; to: EntityRecord; t: number }> {
    const renderTime = now + this.#clockOffset - this.interpDelay;
    let a: StoredSnapshot | undefined = this.#snapshots[0];
    let b: StoredSnapshot | undefined = a;
    for (const snap of this.#snapshots) {
      b = snap;
      if (snap.tick * TICK_MS > renderTime) break;
      a = snap; // renderTime новіший за останній знімок - малюємо останній
    }
    if (!a || !b) return [];
    const span = (b.tick - a.tick) * TICK_MS;
    const t =
      span > 0 ? Math.min(1, Math.max(0, (renderTime - a.tick * TICK_MS) / span)) : 1;

    const pairs: Array<{ from: EntityRecord; to: EntityRecord; t: number }> = [];
    for (const to of b.entities.values()) {
      const old = a.entities.get(to.id);
      // нема в старшому знімку - щойно з'явилась, малюємо як є;
      // нема в новішому - зникла, взагалі не малюємо (цикл іде по b)
      pairs.push({ from: old && old.kind === to.kind ? old : to, to, t });
    }
    return pairs;
  }

  #toDrawable(from: EntityRecord, e: EntityRecord, t: number): Drawable {
    const place = {
      x: lerpWrapped(from.x, e.x, t, ARENA.width),
      y: lerpWrapped(from.y, e.y, t, ARENA.height),
      angle: lerpAngle(from.angle, e.angle, t),
    };
    switch (e.kind) {
      case 'ship':
        return {
          ...place,
          kind: 'ship',
          id: e.id,
          mine: e.id === this.shipId,
          dead: e.dead,
          thrust: e.thrust,
          shield: e.shield,
        };
      case 'bullet':
        return { ...place, kind: 'bullet', missile: e.missile };
      case 'asteroid':
        return { ...place, kind: 'asteroid', id: e.id, big: e.big, hunter: e.hunter };
      case 'pickup':
        return { ...place, kind: 'pickup', effect: e.effect };
      default:
        return assertNever(e);
    }
  }

  stop(): void {
    clearInterval(this.#pingTimer);
  }
}
