// Панель чату в куті екрана: стан з'єднання, хто в кімнаті, повідомлення.

export function createChatView(connection, root) {
  root.innerHTML = `
    <div class="chat">
      <div id="chat-status"></div>
      <div id="chat-roster"></div>
      <div id="chat-log"></div>
      <input id="chat-input" maxlength="200" placeholder="Enter - надіслати" />
    </div>
  `;
  root.hidden = false;

  const status = root.querySelector('#chat-status');
  const roster = root.querySelector('#chat-roster');
  const log = root.querySelector('#chat-log');
  const input = root.querySelector('#chat-input');

  const STATUS_TEXT = {
    connecting: 'підключення...',
    reconnecting: 'перепідключення...',
    waiting: "з'єднання втрачено, чекаю",
    open: 'онлайн',
    closed: 'відключено',
  };

  function addLine(text, className = '') {
    const line = document.createElement('div');
    line.className = className;
    line.textContent = text; // textContent, а не innerHTML - чужий текст не стане HTML
    log.appendChild(line);
    while (log.children.length > 50) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  connection.addEventListener('status', (e) => {
    const { status: s, code } = e.detail;
    status.textContent = STATUS_TEXT[s] + (code ? ` (код ${code})` : '');
    status.className = s === 'open' ? 'ok' : 'bad';
  });

  connection.addEventListener('roster', (e) => {
    roster.textContent = 'У кімнаті: ' + e.detail.players.map((p) => p.name).join(', ');
  });

  connection.addEventListener('chat', (e) => {
    const time = new Date(e.detail.t).toTimeString().slice(0, 5); // "18:05"
    addLine(`${time} ${e.detail.from}: ${e.detail.text}`);
  });

  connection.addEventListener('error', (e) => {
    addLine(`сервер: ${e.detail.message} (${e.detail.code})`, 'bad');
  });

  // поки пишемо в чат, клавіші не мають керувати кораблем:
  // stopPropagation не дає події дійти до слухачів на window
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) {
      connection.send('chat', { text: input.value.trim() });
      input.value = '';
    }
    if (e.key === 'Escape') input.blur();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  return { addLine };
}
