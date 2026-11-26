import { el } from '../dom.ts';
import type { Connection, ConnectionStatus } from '../net/connection.ts';

// Панель чату в куті екрана: стан з'єднання, хто в кімнаті, повідомлення.

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'підключення...',
  reconnecting: 'перепідключення...',
  waiting: "з'єднання втрачено, чекаю",
  open: 'онлайн',
  closed: 'відключено',
};

export function createChatView(connection: Connection, root: HTMLElement) {
  root.innerHTML = `
    <div class="chat">
      <div id="chat-status"></div>
      <div id="chat-roster"></div>
      <div id="chat-log"></div>
      <input id="chat-input" maxlength="200" placeholder="Enter - надіслати" />
    </div>
  `;
  root.hidden = false;

  const status = el(root, '#chat-status', HTMLDivElement);
  const roster = el(root, '#chat-roster', HTMLDivElement);
  const log = el(root, '#chat-log', HTMLDivElement);
  const input = el(root, '#chat-input', HTMLInputElement);

  function addLine(text: string, className = ''): void {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text; // textContent, а не innerHTML - чужий текст не стане HTML
    log.appendChild(line);
    while (log.children.length > 50) log.firstChild?.remove();
    log.scrollTop = log.scrollHeight;
  }

  connection.on('status', ({ status: s, code }) => {
    status.textContent = STATUS_TEXT[s] + (code ? ` (код ${code})` : '');
    status.className = s === 'open' ? 'ok' : 'bad';
  });

  connection.on('roster', (msg) => {
    roster.textContent = 'У кімнаті: ' + msg.players.map((p) => p.name).join(', ');
  });

  connection.on('chat', (msg) => {
    const time = new Date(msg.t).toTimeString().slice(0, 5); // "18:05"
    addLine(`${time} ${msg.from}: ${msg.text}`);
  });

  connection.on('error', (msg) => {
    addLine(`сервер: ${msg.message} (${msg.code})`, 'bad');
  });

  // поки пишемо в чат, клавіші не мають керувати кораблем:
  // stopPropagation не дає події дійти до слухачів на window
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const text = input.value.trim();
    if (e.key === 'Enter' && text) {
      connection.send({ type: 'chat', text });
      input.value = '';
    }
    if (e.key === 'Escape') input.blur();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  return { addLine };
}
