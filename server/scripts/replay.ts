// Показує події з логу матчу в консолі.
// npm run replay --workspace=server -- <ім'я-файлу.ndjson>
import { loadConfig } from '../src/config.ts';
import { listReplays, readEvents, replayPath } from '../src/log/replay.ts';

const config = loadConfig();
if (!config.ok) throw new Error(config.error);
const logDir = config.value.logDir;
const name = process.argv[2];

if (!name) {
  console.log('Логи:');
  for (const r of await listReplays(logDir)) console.log(`  ${r.id} (${r.bytes} байт)`);
  process.exit(0);
}

const file = replayPath(logDir, name);
if (!file) {
  console.error("Неправильне ім'я файлу");
  process.exit(1);
}

for await (const event of readEvents(file)) {
  const time = new Date(event.t).toLocaleTimeString();
  // після перевірки type TypeScript знає, чи є в події name, чи text
  const details = event.type === 'chat' ? `${event.player}: ${event.text}` : event.name;
  console.log(`${time} [${event.type}] ${details}`);
}
