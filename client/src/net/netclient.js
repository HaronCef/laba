import { stepShip, shotId } from 'shared/sim/ship.js';
import { TICK_MS } from 'shared/sim/constants.js';
import { ARENA, wrapValue } from 'shared/sim/arena.js';
import { normalizeAngle } from 'shared/sim/vector.js';
import { FLAG, KIND } from 'shared/protocol.js';
import { encodeInput, decodeSnapshot } from 'shared/codec/binary.js';
import { encodeInputJson, decodeSnapshotJson } from 'shared/codec/json.js';

// Мережева частина гри на клієнті:
//  - шле input з seq кожен крок (30/с);
//  - прогнозує свій корабель тією ж функцією stepShip, що й сервер;
//  - коли приходить знімок: ставить корабель у стан сервера і заново програє
//    ще не підтверджені input (reconciliation), різницю згладжує ~100 мс;
//  - чужі сутності малює трохи в минулому, між двома знімками (interpolation);
//  - свої кулі показує одразу, а потім звіряє з кулями сервера за shotId.
// Події від сервера ('fired', 'hit', 'exploded', 'pickup', 'score') передає далі як свої.

const SMOOTH_MS = 35; // постійна часу згладжування: за ~100 мс від поправки лишається ~5%
const SNAP_DISTANCE = 150; // більша поправка (респаун) - без згладжування, одразу
const BULLET_TTL_MS = 1200;

// різниця з урахуванням "загортання" країв: шлях через край, якщо він коротший
function wrappedDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

function lerpWrapped(a, b, t, size) {
  return wrapValue(a + wrappedDelta(b - a, size) * t, size);
}

function lerpAngle(a, b, t) {
  return a + normalizeAngle(b - a) * t;
}

function shipStateFromRecord(r) {
  return {
    x: r.x,
    y: r.y,
    vx: r.vx,
    vy: r.vy,
    angle: r.angle,
    shotCd: r.owner & 0xff,
    missileCd: r.owner >> 8,
    triple: (r.flags & FLAG.TRIPLE) !== 0,
  };
}

export class NetClient extends EventTarget {
  constructor(connection, { codec = 'binary', interpDelay = 100 } = {}) {
    super();
    this.connection = connection;
    this.codec = codec;
    this.predict = true;
    this.interpDelay = interpDelay; // мс, на скільки в минулому малюємо чужих

    this.shipId = 0;
    this.seq = 0;
    this.pending = []; // input, які сервер ще не підтвердив
    this.snapshots = []; // останні знімки: { tick, ack, entities: Map, arrival }
    this.latest = null;
    this.me = null; // запис мого корабля з останнього знімка

    this.predicted = null; // прогнозований стан мого корабля
    this.prevPredicted = null; // стан на попередньому кроці (для плавного малювання)
    this.lastThrust = false;
    this.offset = { x: 0, y: 0 }; // згладжування поправки
    this.localBullets = [];

    this.clockOffset = null; // час сервера (tick * 33.3 мс) мінус performance.now()
    this.rtt = 0;
    this.corrections = []; // величина поправки на кожен знімок (останні 90)
    this.lastCorrection = 0;

    connection.binaryType = 'arraybuffer';
    connection.addEventListener('joined', (e) => this.#onJoined(e.detail));
    connection.addEventListener('binary', (e) =>
      this.#onSnapshot(decodeSnapshot(e.detail)),
    );
    connection.addEventListener('snapshot', (e) =>
      this.#onSnapshot(decodeSnapshotJson(e.detail)),
    );
    connection.addEventListener('pong', (e) => {
      this.rtt = performance.now() - e.detail.t;
    });
    connection.addEventListener('events', (e) => this.#onEvents(e.detail.list));

    this.pingTimer = setInterval(
      () => connection.send('ping', { t: performance.now() }),
      1000,
    );
  }

  // при кожному (пере)підключенні сервер створює новий корабель
  #onJoined(msg) {
    this.shipId = msg.shipId;
    this.seed = msg.seed;
    this.pending = [];
    this.snapshots = [];
    this.latest = null;
    this.predicted = null;
    this.prevPredicted = null;
    this.localBullets = [];
    this.clockOffset = null;
    this.dispatchEvent(new CustomEvent('joined', { detail: msg }));
  }

  // ---------- input ----------

  // викликається з simulate() кожен крок (1/30 с)
  sendInput(controls, now = performance.now()) {
    if (!this.shipId) return;
    const input = { seq: ++this.seq, ...controls };
    if (this.codec === 'json') {
      this.connection.sendNow(encodeInputJson(input));
    } else {
      this.connection.sendNow(encodeInput(input));
    }

    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift(); // сервер давно не відповідає

    this.prevPredicted = this.predicted;
    this.lastThrust = controls.thrust;
    if (!this.predict || !this.predicted || this.isDead) return;

    // прогноз: та сама функція, що на сервері
    const { state, shots } = stepShip(this.predicted, input);
    this.predicted = state;

    for (const shot of shots) {
      if (shot.missile) continue; // ракета наводиться сама - її показуємо лише з сервера
      this.localBullets.push({
        key: shotId(input.seq, shot.index),
        x: shot.x,
        y: shot.y,
        vx: shot.vx,
        vy: shot.vy,
        angle: shot.angle,
        born: now,
        confirmed: false,
      });
    }
    if (shots.length > 0) {
      this.dispatchEvent(
        new CustomEvent('fired', {
          detail: { ship: this.shipId, missile: shots[0].missile },
        }),
      );
    }
  }

  get isDead() {
    return this.me ? (this.me.flags & FLAG.DEAD) !== 0 : false;
  }

  // ---------- знімки ----------

  #onSnapshot(snap) {
    if (this.latest && snap.tick <= this.latest.tick) return; // запізнився - вже є новіший

    const now = performance.now();
    const s = {
      tick: snap.tick,
      ack: snap.ack,
      entities: new Map(snap.entities.map((e) => [e.id, e])),
      arrival: now,
    };
    this.snapshots.push(s);
    if (this.snapshots.length > 60) this.snapshots.shift();
    this.latest = s;

    // оцінка "годинника сервера": знімок tick був створений приблизно в tick * 33.3 мс
    const sample = s.tick * TICK_MS - now;
    if (this.clockOffset === null || Math.abs(sample - this.clockOffset) > 1000) {
      this.clockOffset = sample;
    } else {
      this.clockOffset += (sample - this.clockOffset) * 0.1;
    }

    this.#reconcile(s);
    this.#checkLocalBullets(s, now);
  }

  #reconcile(s) {
    const me = s.entities.get(this.shipId);
    if (!me) return;
    this.me = me;

    // усе, що сервер уже застосував, з буфера викидаємо
    this.pending = this.pending.filter((input) => input.seq > s.ack);
    const server = shipStateFromRecord(me);

    if (!this.predict || this.isDead || !this.predicted) {
      this.predicted = server;
      this.prevPredicted = server;
      this.offset = { x: 0, y: 0 };
      return;
    }

    // стан сервера + ще не підтверджені input = де корабель має бути зараз
    let state = server;
    for (const input of this.pending) {
      state = stepShip(state, input).state;
    }

    const dx = wrappedDelta(state.x - this.predicted.x, ARENA.width);
    const dy = wrappedDelta(state.y - this.predicted.y, ARENA.height);
    const correction = Math.hypot(dx, dy);
    this.lastCorrection = correction;
    this.corrections.push(correction);
    if (this.corrections.length > 90) this.corrections.shift();

    if (correction > SNAP_DISTANCE) {
      this.offset = { x: 0, y: 0 }; // респаун або великий стрибок - без згладжування
      this.prevPredicted = state;
    } else {
      // корабель одразу в правильному місці, але на екрані компенсуємо різницю,
      // а потім ця компенсація плавно зникає
      this.offset.x -= dx;
      this.offset.y -= dy;
      if (this.prevPredicted) {
        this.prevPredicted = {
          ...this.prevPredicted,
          x: wrapValue(this.prevPredicted.x + dx, ARENA.width),
          y: wrapValue(this.prevPredicted.y + dy, ARENA.height),
        };
      }
    }
    this.predicted = state;
  }

  #checkLocalBullets(s, now) {
    const serverKeys = new Set();
    for (const e of s.entities.values()) {
      if (
        e.kind === KIND.bullet &&
        e.owner === this.shipId &&
        !(e.flags & FLAG.MISSILE)
      ) {
        serverKeys.add(e.extra);
      }
    }
    this.localBullets = this.localBullets.filter((b) => {
      if (serverKeys.has(b.key)) {
        b.confirmed = true; // сервер теж створив цю кулю
        return true;
      }
      if (b.confirmed) return false; // була на сервері, а тепер нема - у щось влучила
      return now - b.born < this.rtt + 300; // сервер її так і не створив
    });
  }

  #onEvents(list) {
    for (const event of list) {
      // свій постріл ми вже озвучили під час прогнозу
      if (event.type === 'fired' && event.ship === this.shipId && this.predict) continue;
      this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
    }
  }

  // ---------- що малювати ----------

  // frameDt - секунди з попереднього кадру, alpha - частка кроку (з loop)
  renderList(alpha, frameDt, now = performance.now()) {
    const list = [];
    if (!this.latest) return list;

    // згладжування поправки згасає
    const k = Math.exp((-frameDt * 1000) / SMOOTH_MS);
    this.offset.x *= k;
    this.offset.y *= k;

    // свої кулі летять самі по собі
    for (const b of this.localBullets) {
      b.x = wrapValue(b.x + b.vx * frameDt, ARENA.width);
      b.y = wrapValue(b.y + b.vy * frameDt, ARENA.height);
    }
    this.localBullets = this.localBullets.filter((b) => now - b.born < BULLET_TTL_MS);
    const localKeys = new Set(this.localBullets.map((b) => b.key));
    for (const b of this.localBullets)
      list.push({ kind: 'bullet', x: b.x, y: b.y, angle: b.angle, missile: false });

    // чужі сутності - в минулому, між двома знімками
    for (const e of this.#interpolated(now)) {
      if (e.kind === 'ship' && e.id === this.shipId) continue;
      if (e.kind === 'bullet' && e.owner === this.shipId && localKeys.has(e.extra))
        continue;
      list.push(e);
    }

    // мій корабель без прогнозу: просто останній знімок (рухається лише коли знімок прийшов)
    if (!this.predict && this.me && !this.isDead) {
      list.push({ ...this.#toDrawable(this.me, this.me, 1), mine: true });
    }

    // мій корабель з прогнозом
    if (this.predict && this.predicted && !this.isDead) {
      const prev = this.prevPredicted || this.predicted;
      list.push({
        kind: 'ship',
        id: this.shipId,
        mine: true,
        x: wrapValue(
          lerpWrapped(prev.x, this.predicted.x, alpha, ARENA.width) + this.offset.x,
          ARENA.width,
        ),
        y: wrapValue(
          lerpWrapped(prev.y, this.predicted.y, alpha, ARENA.height) + this.offset.y,
          ARENA.height,
        ),
        angle: lerpAngle(prev.angle, this.predicted.angle, alpha),
        thrust: this.lastThrust,
        shield: (this.me.flags & FLAG.SHIELD) !== 0,
      });
    }
    return list;
  }

  // знаходимо два знімки навколо часу "зараз мінус interpDelay" і рахуємо проміжне положення
  #interpolated(now) {
    const renderTime = now + this.clockOffset - this.interpDelay;
    const snaps = this.snapshots;
    let a = snaps[0];
    let b = snaps[0];
    for (let i = 0; i < snaps.length; i++) {
      if (snaps[i].tick * TICK_MS <= renderTime) a = snaps[i];
      if (snaps[i].tick * TICK_MS > renderTime) {
        b = snaps[i];
        break;
      }
      b = snaps[i]; // renderTime новіший за останній знімок - малюємо останній
    }
    const span = (b.tick - a.tick) * TICK_MS;
    const t =
      span > 0 ? Math.min(1, Math.max(0, (renderTime - a.tick * TICK_MS) / span)) : 1;

    const result = [];
    for (const eb of b.entities.values()) {
      const ea = a.entities.get(eb.id);
      // нема в старшому знімку - щойно з'явилась, малюємо як є;
      // нема в новішому - зникла, взагалі не малюємо (цикл іде по b)
      const from = ea && ea.kind === eb.kind ? ea : eb;
      result.push(this.#toDrawable(eb, from, t));
    }
    return result;
  }

  #toDrawable(e, from, t) {
    const base = {
      id: e.id,
      x: lerpWrapped(from.x, e.x, t, ARENA.width),
      y: lerpWrapped(from.y, e.y, t, ARENA.height),
      angle: lerpAngle(from.angle, e.angle, t),
      owner: e.owner,
      extra: e.extra,
    };
    if (e.kind === KIND.ship) {
      return {
        ...base,
        kind: 'ship',
        mine: e.id === this.shipId,
        dead: (e.flags & FLAG.DEAD) !== 0,
        thrust: (e.flags & FLAG.THRUST) !== 0,
        shield: (e.flags & FLAG.SHIELD) !== 0,
      };
    }
    if (e.kind === KIND.bullet)
      return { ...base, kind: 'bullet', missile: (e.flags & FLAG.MISSILE) !== 0 };
    if (e.kind === KIND.asteroid) {
      return {
        ...base,
        kind: 'asteroid',
        big: (e.flags & FLAG.BIG) !== 0,
        hunter: (e.flags & FLAG.HUNTER) !== 0,
      };
    }
    return {
      ...base,
      kind: 'pickup',
      effect: e.flags & FLAG.EFFECT_TRIPLE ? 'triple' : 'shield',
    };
  }

  stop() {
    clearInterval(this.pingTimer);
  }
}
