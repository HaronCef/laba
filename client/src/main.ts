import { setupCanvas } from './render/canvas.ts';
import { drawLoading, type LoadingState } from './render/draw.ts';
import { ManifestSchema, errorText, loadAll, loadJson, type Assets } from './assets/loader.ts';
import { createAudio } from './audio.ts';
import { Lobby } from './lobby/lobby.ts';
import { createLobbyView } from './lobby/lobbyView.ts';
import { createChatView } from './lobby/chatView.ts';
import { Connection, serverUrl } from './net/connection.ts';
import { NetClient } from './net/netclient.ts';
import { findPreset } from './net/netgraph.ts';
import { startGame } from './game.ts';
import { el } from './dom.ts';
import { CLOSE, NetsimSchema } from 'shared/protocol.ts';
import { z } from 'zod';

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
// Лаба 5:
//   ?codec=json                 - input і знімки текстом JSON замість бінарного формату
//   ?lag=100&jitter=30&drop=2   - штучна погана мережа (мс туди-назад, ± мс, % втрат); у грі - клавіша N

const params = new URLSearchParams(location.search);
const sequential = params.get('seq') === '1';
const delay = Number(params.get('delay') ?? 0);

const { ctx, size } = setupCanvas(el(document, '#game', HTMLCanvasElement));
const ui = el(document, '#ui', HTMLDivElement);

const audio = createAudio();
// AudioContext можна запустити лише після дії гравця
window.addEventListener('pointerdown', audio.unlock);
window.addEventListener('keydown', audio.unlock);

// додає ?delay=... / ?flaky=... до адреси
function withQuery(url: string, extra: Record<string, number> = {}): string {
  const parts: string[] = [];
  if (delay) parts.push(`delay=${delay}`);
  for (const [key, value] of Object.entries(extra)) parts.push(`${key}=${value}`);
  return parts.length ? `${url}?${parts.join('&')}` : url;
}

// чекає, поки на кнопку натиснуть (подія -> проміс)
function waitForClick(button: HTMLButtonElement): Promise<void> {
  return new Promise((resolve) => {
    button.addEventListener('click', () => resolve(), { once: true });
  });
}

async function loadAssets(failMode: string | null): Promise<Assets> {
  const controller = new AbortController();
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') controller.abort(new DOMException('гравець натиснув Esc', 'AbortError'));
  };
  window.addEventListener('keydown', onKey);

  const state: LoadingState = { title: 'Завантаження...', progress: 0, lines: [], failed: false };
  drawLoading(ctx, size.width, size.height, state);

  let timeoutMs = 5000;
  if (failMode === 'abort') {
    // все повільне, а через 500 мс скасовуємо
    setTimeout(() => controller.abort(new DOMException('скасовано посередині (тест)', 'AbortError')), 500);
  }

  try {
    // маніфест - вхід ззовні: unknown -> Zod
    const manifest = ManifestSchema.parse(await loadJson(withQuery('/assets/manifest.json'), { signal: controller.signal }));

    // підміняємо адреси для тестів збоїв
    const slow: Record<string, number> = failMode === 'abort' ? { delay: 1500 } : {};
    manifest.arena = withQuery(manifest.arena, slow);
    manifest.sprites.url = withQuery(manifest.sprites.url, slow);
    for (const [name, url] of Object.entries(manifest.sounds)) {
      manifest.sounds[name] = withQuery(url, slow);
    }
    if (failMode === '404') manifest.sprites.url = '/assets/no-such-sprites.png';
    if (failMode === 'json') manifest.arena = '/assets/broken.json';
    if (failMode === 'flaky') manifest.arena = withQuery('/assets/arena.json', { flaky: 2 });
    if (failMode === 'timeout') {
      manifest.arena = withQuery('/assets/arena.json', { delay: 3000 });
      timeoutMs = 1000;
    }

    const assets = await loadAll(manifest, {
      audioCtx: audio.ctx,
      signal: controller.signal,
      sequential,
      timeoutMs,
      onProgress(done, total, name, error) {
        state.progress = done / total;
        state.lines.push(error ? `✗ ${name}: ${errorText(error)}` : `✓ ${name}`);
        drawLoading(ctx, size.width, size.height, state);
      },
    });

    const mode = sequential ? 'sequential' : 'concurrent';
    console.log(`[loader] ${mode}: ${assets.timeMs.toFixed(1)} мс`);
    state.title = `Готово за ${Math.round(assets.timeMs)} мс (${mode})`;
    drawLoading(ctx, size.width, size.height, state);
    return assets;
  } catch (err: unknown) {
    // Promise.all вже відхилився, але інші файли ще качаються - зупиняємо їх
    controller.abort(new DOMException('зупинено, бо інший файл не завантажився', 'AbortError'));
    state.failed = true;
    state.title = 'Не вдалося завантажити гру';
    state.lines.push(`✗ ${errorText(err)}`);
    drawLoading(ctx, size.width, size.height, state);
    throw err;
  } finally {
    window.removeEventListener('keydown', onKey);
  }
}

// версія збірки з /health (тег і коміт) - показуємо в лобі і в HUD
async function fetchVersion(): Promise<string> {
  try {
    const res = await fetch('/health', { signal: AbortSignal.timeout(2000) });
    const data: unknown = await res.json();
    const parsed = z.object({ version: z.string(), commit: z.string() }).safeParse(data);
    return parsed.success ? `${parsed.data.version} (${parsed.data.commit.slice(0, 7)})` : '?';
  } catch {
    return '?';
  }
}

// чекаємо, поки сервер знову відповідає на /health, і перезавантажуємо сторінку (= лобі)
async function backToLobbyWhenUp(): Promise<void> {
  for (let delay = 1000; ; delay = Math.min(delay * 2, 8000)) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const up = await fetch('/health', { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) {
      location.reload();
      return;
    }
  }
}

// PWA: service worker лише у зібраній версії (у Vite на :5173 він би заважав)
if ('serviceWorker' in navigator && location.port !== '5173') {
  navigator.serviceWorker.register('/sw.js').catch((err: unknown) => console.warn('[pwa]', err));
}

async function main(): Promise<void> {
  let failMode = params.get('fail');
  let assets: Assets | null = null;

  while (!assets) {
    try {
      assets = await loadAssets(failMode);
    } catch (err: unknown) {
      console.error('[loader]', err);
      ui.innerHTML = '<div class="panel retry"><button id="retry-btn">Retry</button></div>';
      ui.hidden = false;
      await waitForClick(el(ui, '#retry-btn', HTMLButtonElement));
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
  const version = await fetchVersion();
  ctx.fillText(`ассети завантажено за ${Math.round(assets.timeMs)} мс   версія ${version}`, 16, size.height - 16);

  const lobby = new Lobby(withQuery('/api/rooms', failMode === 'lobby' ? { delay: 3000 } : {}), {
    intervalMs: 3000,
    timeoutMs: 2000,
  });
  createLobbyView(lobby, ui);
  lobby.start();

  // чекаємо одну подію "join" як проміс
  const { room, name } = await lobby.once('join');
  audio.unlock(); // клік по Join - це дія гравця, звук можна вмикати

  const codec = params.get('codec') === 'json' ? 'json' : 'binary';
  // параметри з адреси теж через схему: ?drop=99 не пройде
  const netsimParsed = NetsimSchema.safeParse({
    lag: Number(params.get('lag') ?? 0),
    jitter: Number(params.get('jitter') ?? 0),
    drop: Number(params.get('drop') ?? 0) / 100,
  });
  const netsim = netsimParsed.success ? netsimParsed.data : { lag: 0, jitter: 0, drop: 0 };

  // WebSocket: при кожному (пере)підключенні заново кажемо серверу, в яку кімнату йдемо
  const connection = new Connection(serverUrl());
  const net = new NetClient(connection, { codec });
  connection.on('open', () => {
    connection.send({ type: 'join', room: room.id, name, codec, net: netsim });
  });
  const chat = createChatView(connection, el(document, '#chat', HTMLDivElement));
  connection.on('joined', () => chat.addLine(`ви в кімнаті "${room.name}"`, 'ok'));

  // сервер вимикається (деплой) або кімнати вже немає - повертаємось у лобі
  connection.on('shutdown', () => {
    chat.addLine('сервер перезапускається, чекаю і повертаю в лобі...', 'bad');
    void backToLobbyWhenUp();
  });
  connection.on('status', ({ status, code }) => {
    if (status === 'closed' && code === CLOSE.ROOM_UNAVAILABLE) setTimeout(() => location.reload(), 2000);
  });

  // світ рахує сервер: клієнт шле input і малює знімки
  startGame({ ctx, size, assets, room, pilotName: name, audio, net, connection, netPreset: findPreset(netsim), version });
}

void main();
