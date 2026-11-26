import { el } from '../dom.ts';
import { errorText } from '../assets/loader.ts';
import type { RoomInfo } from 'shared/protocol.ts';
import type { Lobby } from './lobby.ts';

// DOM для лобі. Сам нічого не завантажує - лише слухає події Lobby
// і викликає lobby.join(), коли натиснули кнопку.

export function createLobbyView(lobby: Lobby, root: HTMLElement): void {
  root.innerHTML = `
    <div class="panel">
      <h1>Space Duel</h1>
      <label>Ім'я пілота <input id="pilot-name" maxlength="16" value="Pilot" /></label>
      <h2>Кімнати</h2>
      <ul id="room-list"><li>Завантаження...</li></ul>
      <p id="lobby-status"></p>
      <div class="row">
        <input id="new-room" maxlength="24" placeholder="Нова кімната" />
        <button id="create-btn">Створити</button>
      </div>
      <button id="join-btn" disabled>Join</button>
    </div>
  `;
  root.hidden = false;

  const list = el(root, '#room-list', HTMLUListElement);
  const status = el(root, '#lobby-status', HTMLParagraphElement);
  const joinBtn = el(root, '#join-btn', HTMLButtonElement);
  const nameInput = el(root, '#pilot-name', HTMLInputElement);
  const newRoomInput = el(root, '#new-room', HTMLInputElement);
  const createBtn = el(root, '#create-btn', HTMLButtonElement);
  let selectedId: string | null = null;

  function renderRooms(rooms: readonly RoomInfo[]): void {
    list.innerHTML = '';
    for (const room of rooms) {
      const li = document.createElement('li');
      li.textContent = `${room.name} (${room.players}/${room.maxPlayers})`;
      if (room.id === selectedId) li.classList.add('selected');
      li.addEventListener('click', () => {
        selectedId = room.id;
        joinBtn.disabled = false;
        renderRooms(lobby.rooms);
      });
      list.appendChild(li);
    }
  }

  lobby.on('rooms', (rooms) => {
    renderRooms(rooms);
    status.textContent = `Оновлено о ${new Date().toLocaleTimeString()}`;
    status.className = '';
  });

  lobby.on('error', (err) => {
    status.textContent = `Не вдалося оновити список: ${errorText(err)}. Спробую ще раз...`;
    status.className = 'error';
  });

  lobby.on('join', () => {
    root.hidden = true;
    root.innerHTML = '';
  });

  // кімнату, яку щойно створили, одразу вибираємо
  lobby.on('created', (room) => {
    selectedId = room.id;
    joinBtn.disabled = false;
  });

  createBtn.addEventListener('click', () => {
    const name = newRoomInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    // помилки обробляє .catch нижче; void - явно кажемо лінтеру (no-floating-promises), що чекати не треба
    void lobby
      .create(name)
      .then(() => {
        newRoomInput.value = '';
      })
      .catch((err: unknown) => {
        status.textContent = `Не вдалося створити кімнату: ${errorText(err)}`;
        status.className = 'error';
      })
      .finally(() => {
        createBtn.disabled = false;
      });
  });

  joinBtn.addEventListener('click', () => {
    if (selectedId) lobby.join(selectedId, nameInput.value.trim() || 'Pilot');
  });
}
