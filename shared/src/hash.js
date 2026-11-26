// Простий хеш стану (FNV-1a по тексту чисел) - щоб порівняти результат у Node і в браузері
export function hashNumbers(numbers) {
  let h = 0x811c9dc5;
  for (const n of numbers) {
    const text = n.toString();
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
