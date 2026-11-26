import { z } from 'zod';

// Завантаження ассетів: картинки, звуки, JSON.
// Кожна функція приймає { signal } і її можна скасувати через AbortController.

// Помилка HTTP: зберігаємо статус, щоб withRetry знав, чи варто повторювати
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface LoadOptions {
  signal?: AbortSignal;
  attempts?: number;
  baseMs?: number;
  timeoutMs?: number;
}

// fetch не кидає помилку на 404/500, тому перевіряємо ok самі
async function fetchOk(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new HttpError(response.status, url);
  return response;
}

// спільна функція для всіх JSON. Повертає unknown: що там насправді, вирішує схема
export async function fetchJson(
  url: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<unknown> {
  const response = await fetchOk(url, signal);
  const data: unknown = await response.json();
  return data;
}

// пауза, яку теж можна перервати через signal
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

// чи є сенс пробувати ще раз (catch дає unknown, тому спочатку перевіряємо, що це Error)
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 500; // 4xx не повторюємо
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError') return true; // запит завис - можна ще раз
  if (err.name === 'TypeError') return true; // fetch кидає TypeError, якщо немає мережі
  return false; // AbortError, SyntaxError і т.д. - повтор не допоможе
}

export function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// Повтор з exponential backoff + jitter: 200 мс, 400 мс, 800 мс... плюс випадкова добавка.
// fn отримує signal конкретної спроби (загальний signal + таймаут на одну спробу).
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  { attempts = 3, baseMs = 200, timeoutMs = 5000, signal }: LoadOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fn(attemptSignal);
    } catch (err: unknown) {
      if (signal?.aborted) throw signal.reason; // гравець сам скасував
      if (attempt >= attempts || !isRetryable(err)) throw err;

      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * baseMs;
      console.warn(
        `[retry] спроба ${attempt} невдала (${errorText(err)}), ще раз через ${Math.round(delay)} мс`,
      );
      await sleep(delay, signal);
    }
  }
}

export function loadJson(url: string, options: LoadOptions = {}): Promise<unknown> {
  return withRetry((signal) => fetchJson(url, { signal }), options);
}

// Image працює через колбеки onload/onerror - загортаємо в new Promise.
export function loadImage(
  src: string,
  options: LoadOptions = {},
): Promise<HTMLImageElement> {
  return withRetry(async (signal) => {
    const blob = await (await fetchOk(src, signal)).blob();
    const objectUrl = URL.createObjectURL(blob);
    return new Promise<HTMLImageElement>((resolve, reject) => {
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
export function loadAudio(
  ctx: AudioContext,
  url: string,
  options: LoadOptions = {},
): Promise<AudioBuffer> {
  return withRetry(async (signal) => {
    const data = await (await fetchOk(url, signal)).arrayBuffer();
    return ctx.decodeAudioData(data);
  }, options);
}

// ---------- маніфест ----------

export const ManifestSchema = z.object({
  sprites: z.object({
    url: z.string(),
    frameSize: z.number().int().positive(),
    frames: z.array(z.string()),
  }),
  sounds: z.record(z.string(), z.string()),
  arena: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const ArenaFileSchema = z.object({
  stars: z.number().int().min(0).max(1000).default(180),
});
export type ArenaFile = z.infer<typeof ArenaFileSchema>;

export interface Sprites {
  readonly image: HTMLImageElement;
  readonly frameSize: number;
  readonly frames: readonly string[];
}

export interface Assets {
  readonly arena: ArenaFile;
  readonly sprites: Sprites | null; // null - не завантажились, малюємо фігурами
  readonly sounds: ReadonlyMap<string, AudioBuffer>;
  readonly timeMs: number;
}

interface Task<T> {
  readonly name: string;
  readonly url: string;
  readonly optional: boolean;
  load(url: string, options: LoadOptions): Promise<T>;
}

export interface LoadAllOptions {
  audioCtx: AudioContext;
  onProgress?: (done: number, total: number, name: string, error: unknown) => void;
  signal?: AbortSignal;
  sequential?: boolean;
  timeoutMs?: number;
}

// Завантажує все з маніфесту. onProgress викликається після кожного файлу.
// sequential: true - по одному (для порівняння часу з лаби 3).
export async function loadAll(
  manifest: Manifest,
  { audioCtx, onProgress, signal, sequential = false, timeoutMs = 5000 }: LoadAllOptions,
): Promise<Assets> {
  const options: LoadOptions = signal ? { signal, timeoutMs } : { timeoutMs };
  const arenaTask: Task<ArenaFile> = {
    name: 'arena',
    url: manifest.arena,
    optional: false,
    // arena.json теж вхід ззовні: unknown -> схема (битий JSON дасть помилку, як у лабі 3)
    load: async (url, opts) => ArenaFileSchema.parse(await loadJson(url, opts)),
  };
  const spriteTask: Task<HTMLImageElement> = {
    name: 'sprites',
    url: manifest.sprites.url,
    optional: true,
    load: (url, opts) => loadImage(url, opts),
  };
  const soundTasks: Array<Task<AudioBuffer>> = Object.entries(manifest.sounds).map(
    ([name, url]) => ({
      name: `sound:${name}`,
      url,
      optional: true,
      load: (u, opts) => loadAudio(audioCtx, u, opts),
    }),
  );

  const total = 2 + soundTasks.length;
  let done = 0;
  const start = performance.now();

  // один файл + підрахунок прогресу. Для необов'язкових при помилці повертає null.
  async function run<T>(task: Task<T>): Promise<T | null> {
    try {
      const value = await task.load(task.url, options);
      onProgress?.(++done, total, task.name, null);
      return value;
    } catch (err: unknown) {
      onProgress?.(++done, total, task.name, err);
      if (task.optional && !signal?.aborted) {
        console.warn(`[loader] ${task.name} пропущено: ${errorText(err)}`);
        return null; // гра обійдеться
      }
      throw err;
    }
  }

  let arena: ArenaFile | null;
  let image: HTMLImageElement | null;
  let buffers: Array<AudioBuffer | null>;
  if (sequential) {
    arena = await run(arenaTask);
    image = await run(spriteTask);
    buffers = [];
    for (const task of soundTasks) buffers.push(await run(task));
  } else {
    // Promise.all з кортежем зберігає тип кожного елемента
    [arena, image, buffers] = await Promise.all([
      run(arenaTask),
      run(spriteTask),
      Promise.all(soundTasks.map(run)),
    ]);
  }
  if (!arena) throw new Error('arena.json не завантажився');

  const sounds = new Map<string, AudioBuffer>();
  soundTasks.forEach((task, i) => {
    const buffer = buffers[i];
    if (buffer) sounds.set(task.name.slice('sound:'.length), buffer);
  });

  return {
    arena,
    sprites: image
      ? { image, frameSize: manifest.sprites.frameSize, frames: manifest.sprites.frames }
      : null,
    sounds,
    timeMs: performance.now() - start,
  };
}
