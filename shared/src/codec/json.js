// Той самий input і snapshot, але текстом JSON. Вмикається ?codec=json
// (щоб було з чим порівняти бінарний формат).

export function encodeInputJson(input) {
  return JSON.stringify({ v: 0, type: 'input', ...input });
}

export function encodeSnapshotJson({ tick, ack, entities }) {
  return JSON.stringify({ v: 0, type: 'snapshot', tick, ack, entities });
}

export function decodeSnapshotJson(text) {
  const msg = typeof text === 'string' ? JSON.parse(text) : text;
  return { tick: msg.tick, ack: msg.ack, entities: msg.entities };
}
