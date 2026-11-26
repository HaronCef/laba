import { z } from 'zod';
import { asEntityId, asPlayerId, asSeq, asTick, fail, ok, type Result } from './types.ts';

// Протокол гри - єдине джерело правди. Для кожного JSON-повідомлення є Zod-схема,
// а TypeScript-тип виводиться з неї (z.infer), тому схема і тип не можуть розійтися.
// Типи після збірки зникають, тому все, що приходить з мережі, перевіряється схемою в рантаймі.
// input і snapshot за замовчуванням ідуть бінарно (codec/binary.ts), тоді їх перевіряє декодер.

export const PROTOCOL_VERSION = 0;

// ---------- спільні шматки ----------

const u16 = z.number().int().min(0).max(0xffff);
const u32 = z.number().int().min(0).max(0xffffffff);
const coord = z.number().finite();

export const EntityIdSchema = u16.transform(asEntityId);
export const TickSchema = u32.transform(asTick);
export const SeqSchema = u32.transform(asSeq);
export const PlayerIdSchema = u32.transform(asPlayerId);

const v = z.literal(PROTOCOL_VERSION);
const roomId = z.string().regex(/^[a-z0-9-]{1,32}$/);
const name = z.string().trim().min(1).max(16);

export const NetsimSchema = z.object({
  lag: z.number().min(0).max(1000),
  jitter: z.number().min(0).max(500),
  drop: z.number().min(0).max(0.5),
});
export type Netsim = z.infer<typeof NetsimSchema>;

// ---------- input ----------

export const InputSchema = z.object({
  seq: SeqSchema,
  turn: z.union([z.literal(-1), z.literal(0), z.literal(1)]), // turn = 1000 - чит
  thrust: z.boolean(),
  fire: z.boolean(),
  missile: z.boolean(),
  flip: z.boolean(),
});
export type Input = Readonly<z.infer<typeof InputSchema>>;

// ---------- клієнт -> сервер ----------

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('join'),
    room: roomId,
    name,
    codec: z.enum(['binary', 'json']).optional(),
    net: NetsimSchema.optional(),
  }),
  z.object({ v, type: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ v, type: z.literal('leave') }),
  InputSchema.extend({ v, type: z.literal('input') }),
  z.object({ v, type: z.literal('ping'), t: z.number().finite() }),
  NetsimSchema.extend({ v, type: z.literal('netsim') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- знімок ----------

const entityBase = {
  id: EntityIdSchema,
  x: coord,
  y: coord,
  vx: coord,
  vy: coord,
  angle: coord,
};

export const EntityRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ship'),
    ...entityBase,
    thrust: z.boolean(),
    shield: z.boolean(),
    triple: z.boolean(),
    dead: z.boolean(),
    shotCd: z.number().int().min(0).max(255),
    missileCd: z.number().int().min(0).max(255),
    hp: u16,
  }),
  z.object({
    kind: z.literal('bullet'),
    ...entityBase,
    missile: z.boolean(),
    owner: EntityIdSchema,
    shotId: u16,
  }),
  z.object({
    kind: z.literal('asteroid'),
    ...entityBase,
    big: z.boolean(),
    hunter: z.boolean(),
    hp: u16,
  }),
  z.object({
    kind: z.literal('pickup'),
    ...entityBase,
    effect: z.enum(['shield', 'triple']),
  }),
]);
export type EntityRecord = Readonly<z.infer<typeof EntityRecordSchema>>;
export type EntityKind = EntityRecord['kind'];
export type ShipRecord = Extract<EntityRecord, { kind: 'ship' }>;

export const SnapshotSchema = z.object({
  tick: TickSchema,
  ack: SeqSchema, // lastProcessedSeq саме цього клієнта
  entities: z.array(EntityRecordSchema).readonly(),
});
export type Snapshot = Readonly<z.infer<typeof SnapshotSchema>>;

// ---------- події гри (сервер -> клієнт, для звуку, вибухів, очок) ----------

const xy = { x: coord, y: coord };

export const GameEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fired'),
    ship: EntityIdSchema,
    missile: z.boolean(),
    ...xy,
  }),
  z.object({
    type: z.literal('hit'),
    target: z.enum(['asteroid', 'ship']),
    ship: EntityIdSchema.optional(),
    ...xy,
  }),
  z.object({
    type: z.literal('exploded'),
    kind: z.enum(['asteroid', 'ship']),
    size: z.number().int().optional(),
    ship: EntityIdSchema.optional(),
    ...xy,
  }),
  z.object({
    type: z.literal('pickup'),
    effect: z.enum(['shield', 'triple']),
    ship: EntityIdSchema,
    ...xy,
  }),
  z.object({
    type: z.literal('score'),
    ship: EntityIdSchema,
    score: z.number().int(),
    delta: z.number().int(),
    ...xy,
  }),
]);
export type GameEvent = Readonly<z.infer<typeof GameEventSchema>>;
export type GameEventType = GameEvent['type'];

// ---------- сервер -> клієнт ----------

export const RoomInfoSchema = z.object({
  id: roomId,
  name: z.string(),
  players: z.number().int(),
  maxPlayers: z.number().int(),
  arena: z.object({
    waveBase: z.number().int().optional(),
    hunterEvery: z.number().int().optional(),
    pickupEvery: z.number().optional(),
  }),
});
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('joined'),
    room: RoomInfoSchema,
    you: PlayerIdSchema,
    shipId: EntityIdSchema,
    seed: u32,
    tick: TickSchema,
  }),
  z.object({
    v,
    type: z.literal('roster'),
    players: z.array(
      z.object({ id: PlayerIdSchema, name: z.string(), shipId: EntityIdSchema }),
    ),
  }),
  z.object({
    v,
    type: z.literal('chat'),
    from: z.string(),
    text: z.string(),
    t: z.number(),
  }),
  z.object({
    v,
    type: z.literal('events'),
    tick: TickSchema,
    list: z.array(GameEventSchema),
  }),
  z.object({ v, type: z.literal('pong'), t: z.number() }),
  z.object({ v, type: z.literal('error'), code: z.number().int(), message: z.string() }),
  SnapshotSchema.extend({ v, type: z.literal('snapshot') }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------- розбір без винятків ----------

// коди закриття (4000-4999 - коди для свого застосунку)
export const CLOSE = {
  NORMAL: 1000,
  SHUTDOWN: 1001, // сервер вимикається
  TOO_BIG: 1009, // ставить сама бібліотека ws, якщо більше maxPayload
  BAD_MESSAGE: 4000, // не JSON або неправильна форма
  UNKNOWN_TYPE: 4001,
  BAD_VERSION: 4002,
  JOIN_TIMEOUT: 4003, // не надіслав join за 5 с
  RATE_LIMIT: 4004, // забагато повідомлень за секунду
  ROOM_UNAVAILABLE: 4005, // кімнати немає або вона повна
  SLOW_CLIENT: 4006, // не встигає приймати
  NO_HEARTBEAT: 4007, // не відповідав на ping
} satisfies Record<string, number>;

export interface ParseError {
  readonly code: number;
  readonly reason: string;
}

// окремі маленькі схеми, щоб віддати правильний код закриття
const HasVersion = z.object({ v });
const HasKnownType = z.object({
  type: z.enum(['join', 'chat', 'leave', 'input', 'ping', 'netsim']),
});

// Приймає будь-що (unknown) і ніколи не кидає виняток: або повідомлення, або код помилки.
export function parseClientMessage(data: unknown): Result<ClientMessage, ParseError> {
  if (typeof data !== 'string')
    return fail({ code: CLOSE.BAD_MESSAGE, reason: 'not text' });
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return fail({ code: CLOSE.BAD_MESSAGE, reason: 'not JSON' });
  }
  if (!HasVersion.safeParse(raw).success)
    return fail({ code: CLOSE.BAD_VERSION, reason: 'bad version' });
  if (!HasKnownType.safeParse(raw).success)
    return fail({ code: CLOSE.UNKNOWN_TYPE, reason: 'unknown type' });

  const result = ClientMessageSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return fail({
      code: CLOSE.BAD_MESSAGE,
      reason: first ? `${first.path.join('.')}: ${first.message}` : 'bad message',
    });
  }
  return ok(result.data);
}

export function parseServerMessage(data: unknown): Result<ServerMessage> {
  if (typeof data !== 'string') return fail('not text');
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return fail('not JSON');
  }
  const result = ServerMessageSchema.safeParse(raw);
  return result.success
    ? ok(result.data)
    : fail(result.error.issues[0]?.message ?? 'bad message');
}

// Повідомлення без поля v. "M extends unknown ? ... : never" - так Omit застосовується
// до кожного варіанта union окремо, і зв'язок type -> поля не губиться.
export type WithoutVersion<M> = M extends unknown ? Omit<M, 'v'> : never;

// Готове повідомлення сервера з версією. Тип перевіряє, що поля правильні для цього type.
export function serverMessage(msg: WithoutVersion<ServerMessage>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

export function clientMessage(msg: WithoutVersion<ClientMessage>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}
