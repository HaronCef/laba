// DOM для лобі. Сам нічого не завантажує - лише слухає події Lobby
// і викликає lobby.join(), коли натиснули кнопку.

export function createLobbyView(lobby, root) {
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

  const list = root.querySelector('#room-list');
  const status = root.querySelector('#lobby-status');
  const joinBtn = root.querySelector('#join-btn');
  const nameInput = root.querySelector('#pilot-name');
  const newRoomInput = root.querySelector('#new-room');
  const createBtn = root.querySelector('#create-btn');
  let selectedId = null;

  function renderRooms(rooms) {
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

  lobby.addEventListener('rooms', (e) => {
    renderRooms(e.detail.rooms);
    status.textContent = `Оновлено о ${new Date().toLocaleTimeString()}`;
    status.className = '';
  });

  lobby.addEventListener('error', (e) => {
    status.textContent = `Не вдалося оновити список: ${e.detail.error.message}. Спробую ще раз...`;
    status.className = 'error';
  });

  lobby.addEventListener('join', () => {
    root.hidden = true;
    root.innerHTML = '';
  });

  // кімнату, яку щойно створили, одразу вибираємо
  lobby.addEventListener('created', (e) => {
    selectedId = e.detail.room.id;
    joinBtn.disabled = false;
  });

  createBtn.addEventListener('click', async () => {
    const name = newRoomInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      await lobby.create(name);
      newRoomInput.value = '';
    } catch (err) {
      status.textContent = `Не вдалося створити кімнату: ${err.message}`;
      status.className = 'error';
    } finally {
      createBtn.disabled = false;
    }
  });

  joinBtn.addEventListener('click', () => {
    lobby.join(selectedId, nameInput.value.trim() || 'Pilot');
  });
}
