import path from 'node:path';

// Усі налаштування беремо з оточення (process.env) і одразу перевіряємо.
// Якщо щось не так - сервер не стартує і пише, що саме не так.

function readInt(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name} має бути цілим числом від ${min} до ${max}, а зараз "${raw}"`,
    );
  }
  return value;
}

export function loadConfig(env = process.env) {
  const serverDir = path.resolve(import.meta.dirname, '..');

  return {
    port: readInt(env, 'PORT', 3000, 1, 65535),
    host: env.HOST || '127.0.0.1',
    // відносні шляхи рахуємо від папки server/, а не від того, звідки запустили
    logDir: path.resolve(serverDir, env.LOG_DIR || './logs'),
    staticDir: path.resolve(serverDir, env.STATIC_DIR || '../client/dist'),
    maxRooms: readInt(env, 'MAX_ROOMS', 20, 1, 1000),
    maxPlayersPerRoom: readInt(env, 'MAX_PLAYERS', 8, 2, 64),
  };
}
