import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

// Повертає безпечний шлях усередині root або null.
// "/../../etc/passwd" після path.join вийде за межі root - такий запит відхиляємо.
export function safePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // зламане %-кодування
  }
  if (decoded.includes('\0') || decoded.split(/[/\\]/).includes('..')) return null;

  const full = path.join(root, decoded);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function fileInfo(file: string): Promise<Stats | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

// Віддає зібраний клієнт (client/dist). Повертає false, якщо такого файлу немає.
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  urlPath: string,
): Promise<boolean> {
  const file = safePath(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!file) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return true;
  }

  const info = await fileInfo(file);
  if (!info) return false;

  const ext = path.extname(file);
  // файли з /assets/ Vite називає з хешем (main-3f9a1c.js), їх можна кешувати надовго
  const hashed = urlPath.startsWith('/assets/') && (ext === '.js' || ext === '.css');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream', // MIME[ext] може бути undefined
    'content-length': info.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await pipeline(createReadStream(file), res);
  return true;
}
