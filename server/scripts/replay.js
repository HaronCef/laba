// Показує події з логу матчу в консолі.
// npm run replay --workspace=server -- <ім'я-файлу.ndjson>
import { loadConfig } from '../src/config.js';
import { listReplays, readEvents, replayPath } from '../src/log/replay.js';

const config = loadConfig();
const name = process.argv[2];

if (!name) {
  console.log('Логи:');
  for (const r of await listReplays(config.logDir))
    console.log(`  ${r.id} (${r.bytes} байт)`);
  process.exit(0);
}

const file = replayPath(config.logDir, name);
if (!file) {
  console.error("Неправильне ім'я файлу");
  process.exit(1);
}

for await (const event of readEvents(file)) {
  const time = new Date(event.t).toLocaleTimeString();
  console.log(
    `${time} [${event.type}] ${event.name ?? event.player ?? ''} ${event.text ?? ''}`,
  );
}
