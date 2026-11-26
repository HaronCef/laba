import pino from 'pino';

// Логи - рядки JSON у stdout (pino). Хостинг сам їх збирає, а шукати можна по roomId/playerId.
// Рівень - з LOG_LEVEL. Паролів і ключів у логах немає (їх у грі й нема), а про всяк випадок
// поля з такими назвами pino замінює на [Redacted].
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'space-duel' },
  redact: ['password', 'token', 'secret', '*.password', '*.token', '*.secret'],
});
