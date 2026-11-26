// Завантаження ассетів: картинки, звуки, JSON.
// Кожна функція приймає { signal } і її можна скасувати через AbortController.

// Помилка HTTP: зберігаємо статус, щоб withRetry знав, чи варто повторювати
export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

// fetch не кидає помилку на 404/500, тому перевіряємо ok самі
async function fetchOk(url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new HttpError(response.status, url);
  }
  return response;
}

// спільна функція для всіх JSON. Битий JSON кине SyntaxError на response.json()
export async function fetchJson(url, { signal } = {}) {
  const response = await fetchOk(url, { signal });
  return response.json();
}

// пауза, яку теж можна перервати через signal
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// чи є сенс пробувати ще раз
function isRetryable(err) {
  if (err.name === 'HttpError') return err.status >= 500; // 4xx не повторюємо
  if (err.name === 'TimeoutError') return true; // запит завис - можна ще раз
  if (err.name === 'TypeError') return true; // fetch кидає TypeError, якщо немає мережі
  return false; // AbortError, SyntaxError і т.д. - повтор не допоможе
}

// Повтор з exponential backoff + jitter: 200 мс, 400 мс, 800 мс... плюс випадкова добавка,
// щоб багато клієнтів не повторювали запит одночасно.
// fn отримує signal конкретної спроби (загальний signal + таймаут на одну спробу).
export async function withRetry(
  fn,
  { attempts = 3, baseMs = 200, timeoutMs = 5000, signal } = {},
) {
  for (let attempt = 1; ; attempt++) {
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      return await fn(attemptSignal);
    } catch (err) {
      if (signal?.aborted) throw signal.reason; // гравець сам скасував
      if (attempt >= attempts || !isRetryable(err)) throw err;

      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * baseMs;
      console.warn(
        `[retry] спроба ${attempt} невдала (${err.message}), ще раз через ${Math.round(delay)} мс`,
      );
      await sleep(delay, signal);
    }
  }
}

export function loadJson(url, options = {}) {
  return withRetry((signal) => fetchJson(url, { signal }), options);
}

// Image працює через колбеки onload/onerror - загортаємо в new Promise.
// Спочатку качаємо файл через fetch, щоб знати статус (404) і мати abort.
export function loadImage(src, options = {}) {
  return withRetry(async (signal) => {
    const response = await fetchOk(src, { signal });
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`не вдалося розібрати картинку ${src}`));
      };
      img.src = objectUrl;
    });
  }, options);
}

// звук декодуємо одразу при завантаженні, а не при першому пострілі
export function loadAudio(ctx, url, options = {}) {
  return withRetry(async (signal) => {
    const response = await fetchOk(url, { signal });
    const data = await response.arrayBuffer();
    return ctx.decodeAudioData(data);
  }, options);
}

// Список того, що треба завантажити, з manifest.json.
// optional: true - якщо не завантажилось, гра все одно стартує (без спрайтів / без звуку)
function makeTasks(manifest, audioCtx) {
  const tasks = [];
  tasks.push({
    name: 'arena',
    url: manifest.arena,
    optional: false,
    load: (url, opts) => loadJson(url, opts),
  });
  tasks.push({
    name: 'sprites',
    url: manifest.sprites.url,
    optional: true,
    load: (url, opts) => loadImage(url, opts),
  });
  for (const [name, url] of Object.entries(manifest.sounds)) {
    tasks.push({
      name: `sound:${name}`,
      url,
      optional: true,
      load: (u, opts) => loadAudio(audioCtx, u, opts),
    });
  }
  return tasks;
}

// Завантажує все з маніфесту. onProgress(done, total, task, error) викликається
// після кожного файлу. sequential: true - по одному (для порівняння часу).
export async function loadAll(
  manifest,
  { audioCtx, onProgress, signal, sequential = false, timeoutMs = 5000 } = {},
) {
  const tasks = makeTasks(manifest, audioCtx);
  const total = tasks.length;
  let done = 0;
  const start = performance.now();

  // один файл + підрахунок прогресу
  function run(task) {
    return task
      .load(task.url, { signal, timeoutMs })
      .then((value) => {
        done++;
        onProgress?.(done, total, task, null);
        return value;
      })
      .catch((err) => {
        done++;
        onProgress?.(done, total, task, err);
        if (task.optional && !signal?.aborted) {
          console.warn(`[loader] ${task.name} пропущено: ${err.message}`);
          return null; // гра обійдеться
        }
        throw err;
      });
  }

  let results;
  if (sequential) {
    results = [];
    for (const task of tasks) {
      results.push(await run(task));
    }
  } else {
    results = await Promise.all(tasks.map(run));
  }

  const assets = {
    arena: null,
    sprites: null,
    sounds: {},
    timeMs: performance.now() - start,
  };
  tasks.forEach((task, i) => {
    if (task.name === 'arena') assets.arena = results[i];
    else if (task.name === 'sprites' && results[i]) {
      assets.sprites = { image: results[i], ...manifest.sprites };
    } else if (task.name.startsWith('sound:') && results[i]) {
      assets.sounds[task.name.slice(6)] = results[i];
    }
  });
  return assets;
}
