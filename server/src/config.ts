import path from 'node:path';
import { z } from 'zod';
import { fail, ok, type Result } from 'shared/types.ts';

// Усі налаштування беремо з оточення (process.env) і перевіряємо Zod-схемою.
// Змінні оточення - теж "вхід у процес": там може бути що завгодно, тому unknown -> схема.
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_DIR: z.string().min(1).default('./logs'),
  STATIC_DIR: z.string().min(1).default('../client/dist'),
  MAX_ROOMS: z.coerce.number().int().min(1).max(1000).default(20),
  MAX_PLAYERS: z.coerce.number().int().min(2).max(64).default(8),
});

export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly logDir: string; // абсолютний шлях
  readonly staticDir: string; // абсолютний шлях
  readonly maxRooms: number;
  readonly maxPlayersPerRoom: number;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Result<ServerConfig> {
  // порожнє значення (PORT=) вважаємо "не задано" - тоді спрацює default
  const filled = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== ''),
  );
  const parsed = EnvSchema.safeParse(filled);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue ? `${issue.path.join('.')}: ${issue.message}` : 'bad config');
  }

  // відносні шляхи рахуємо від папки server/, а не від того, звідки запустили
  const serverDir = path.resolve(import.meta.dirname, '..');
  const e = parsed.data;
  return ok({
    port: e.PORT,
    host: e.HOST,
    logDir: path.resolve(serverDir, e.LOG_DIR),
    staticDir: path.resolve(serverDir, e.STATIC_DIR),
    maxRooms: e.MAX_ROOMS,
    maxPlayersPerRoom: e.MAX_PLAYERS,
  });
}
