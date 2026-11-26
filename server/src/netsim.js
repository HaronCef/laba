// Штучна погана мережа для перевірки (лаба 5). Налаштування на кожне з'єднання:
//   lag    - затримка туди-назад у мс (кожен бік отримує половину)
//   jitter - розкид ± мс (теж навпіл на кожен бік)
//   drop   - частка пакетів, що губляться (0.02 = 2%). Губимо лише input і знімки:
//            join, чат, події не губимо, бо в справжній грі вони йшли б надійним каналом.

export const NO_NETSIM = { lag: 0, jitter: 0, drop: 0 };

export function isValidNetsim(net) {
  return (
    net !== null &&
    typeof net === 'object' &&
    Number.isFinite(net.lag) &&
    net.lag >= 0 &&
    net.lag <= 1000 &&
    Number.isFinite(net.jitter) &&
    net.jitter >= 0 &&
    net.jitter <= 500 &&
    Number.isFinite(net.drop) &&
    net.drop >= 0 &&
    net.drop <= 0.5
  );
}

// Викликає fn пізніше (або ніколи, якщо пакет "загубився").
// Math.random тут можна: це не симуляція гри, а імітація мережі.
export function throughNetsim(net, fn, { droppable = false } = {}) {
  if (droppable && net.drop > 0 && Math.random() < net.drop) return false;
  if (net.lag === 0 && net.jitter === 0) {
    fn();
    return true;
  }
  const oneWay = net.lag / 2 + ((Math.random() * 2 - 1) * net.jitter) / 2;
  setTimeout(fn, Math.max(0, oneWay));
  return true;
}
