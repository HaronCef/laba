import { setupCanvas } from './render/canvas.js';
import { drawLoading } from './render/draw.js';
import { createArena } from './sim/arena.js';
import { loadJson, loadAll } from './assets/loader.js';
import { createAudio } from './audio.js';
import { Lobby } from './lobby/lobby.js';
import { createLobbyView } from './lobby/lobbyView.js';
import { createChatView } from './lobby/chatView.js';
import { Connection, serverUrl } from './net/connection.js';
import { startGame } from './game.js';

// Порядок: екран завантаження -> лобі -> гра.
//
// Параметри для перевірки (README, галерея збоїв):
//   ?seq=1        - завантажувати по одному файлу (sequential await)
//   ?delay=200    - кожна відповідь сервера на 200 мс пізніше
//   ?fail=404     - спрайтшита не існує
//   ?fail=timeout - arena.json відповідає довше за таймаут
//   ?fail=abort   - завантаження скасовується посередині (або Esc під час завантаження)
//   ?fail=json    - битий arena.json
//   ?fail=flaky   - arena.json двічі відповідає 503, потім нормально (видно ретраї)
//   ?fail=lobby   - список кімнат відповідає довше за таймаут лобі

const params = new URLSearchParams(location.search);
const sequential = params.get('seq') === '1';
const delay = Number(params.get('delay') || 0);

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const arena = createArena(800, 600);
const { ctx, size } = setupCanvas(canvas, (w, h) => {
  arena.width = w;
  arena.height = h;
});

const audio = createAudio();
// AudioContext можна запустити лише після дії гравця
window.addEventListener('pointerdown', audio.unlock);
window.addEventListener('keydown', audio.unlock);

// додає ?delay=... / ?flaky=... до адреси
function withQuery(url, extra) {
  const parts = [];
  if (delay) parts.push(`delay=${delay}`);
  for (const [key, value] of Object.entries(extra)) parts.push(`${key}=${value}`);
  return parts.length ? `${url}?${parts.join('&')}` : url;
}

// чекає, поки на кнопку натиснуть (подія -> проміс)
function waitForClick(button) {
  return new Promise((resolve) => {
    button.addEventListener('click', resolve, { once: true });
  });
}

async function loadAssets(failMode) {
  const controller = new AbortController();
  const onKey = (e) => {
    if (e.code === 'Escape') {
      controller.abort(new DOMException('гравець натиснув Esc', 'AbortError'));
    }
  };
  window.addEventListener('keydown', onKey);

  const state = { title: 'Завантаження...', progress: 0, lines: [], failed: false };
  drawLoading(ctx, size.width, size.height, state);

  let timeoutMs = 5000;
  if (failMode === 'abort') {
    // все повільне, а через 500 мс скасовуємо
    setTimeout(
      () =>
        controller.abort(new DOMException('скасовано посередині (тест)', 'AbortError')),
      500,
    );
  }

  try {
    const manifest = await loadJson(withQuery('/assets/manifest.json', {}), {
      signal: controller.signal,
    });

    // підміняємо адреси для тестів збоїв
    const slow = failMode === 'abort' ? { delay: 1500 } : {};
    manifest.arena = withQuery(manifest.arena, slow);
    manifest.sprites.url = withQuery(manifest.sprites.url, slow);
    for (const name in manifest.sounds) {
      manifest.sounds[name] = withQuery(manifest.sounds[name], slow);
    }
    if (failMode === '404') manifest.sprites.url = '/assets/no-such-sprites.png';
    if (failMode === 'json') manifest.arena = '/assets/broken.json';
    if (failMode === 'flaky')
      manifest.arena = withQuery('/assets/arena.json', { flaky: 2 });
    if (failMode === 'timeout') {
      manifest.arena = withQuery('/assets/arena.json', { delay: 3000 });
      timeoutMs = 1000;
    }

    const assets = await loadAll(manifest, {
      audioCtx: audio.ctx,
      signal: controller.signal,
      sequential,
      timeoutMs,
      onProgress(done, total, task, error) {
        state.progress = done / total;
        state.lines.push(error ? `✗ ${task.name}: ${error.message}` : `✓ ${task.name}`);
        drawLoading(ctx, size.width, size.height, state);
      },
    });

    const mode = sequential ? 'sequential' : 'concurrent';
    console.log(`[loader] ${mode}: ${assets.timeMs.toFixed(1)} мс`);
    state.title = `Готово за ${Math.round(assets.timeMs)} мс (${mode})`;
    drawLoading(ctx, size.width, size.height, state);
    return assets;
  } catch (err) {
    // Promise.all вже відхилився, але інші файли ще качаються - зупиняємо їх
    controller.abort(
      new DOMException('зупинено, бо інший файл не завантажився', 'AbortError'),
    );
    state.failed = true;
    state.title = 'Не вдалося завантажити гру';
    state.lines.push(`✗ ${err.name}: ${err.message}`);
    drawLoading(ctx, size.width, size.height, state);
    throw err;
  } finally {
    window.removeEventListener('keydown', onKey);
  }
}

async function main() {
  let failMode = params.get('fail');
  let assets = null;

  while (!assets) {
    try {
      assets = await loadAssets(failMode);
    } catch (err) {
      console.error('[loader]', err);
      ui.innerHTML =
        '<div class="panel retry"><button id="retry-btn">Retry</button></div>';
      ui.hidden = false;
      await waitForClick(document.getElementById('retry-btn'));
      ui.hidden = true;
      failMode = null; // у демо повторна спроба вже без симуляції збою
    }
  }

  audio.setBuffers(assets.sounds);

  // під лобі - чистий фон і час завантаження внизу
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.fillStyle = '#8890b0';
  ctx.font = '13px monospace';
  ctx.fillText(
    `ассети завантажено за ${Math.round(assets.timeMs)} мс`,
    16,
    size.height - 16,
  );

  const roomsUrl = withQuery('/api/rooms', failMode === 'lobby' ? { delay: 3000 } : {});
  const lobby = new Lobby(roomsUrl, { intervalMs: 3000, timeoutMs: 2000 });
  createLobbyView(lobby, ui);
  lobby.start();

  // чекаємо одну подію "join" як проміс
  const { room, name } = await new Promise((resolve) => {
    lobby.addEventListener('join', (e) => resolve(e.detail), { once: true });
  });

  audio.unlock(); // клік по Join - це дія гравця, звук можна вмикати

  // WebSocket: при кожному (пере)підключенні заново кажемо серверу, в яку кімнату йдемо
  const connection = new Connection(serverUrl());
  connection.addEventListener('open', () => {
    connection.send('join', { room: room.id, name });
  });
  const chat = createChatView(connection, document.getElementById('chat'));
  connection.addEventListener('joined', () =>
    chat.addLine(`ви в кімнаті "${room.name}"`, 'ok'),
  );

  // координати кораблів поки не передаються (це лаба 5) - гра локальна
  startGame({ ctx, size, arena, assets, room, pilotName: name, audio });
}

main();
