// Знайти елемент і перевірити, що він саме того типу. Замість "as HTMLInputElement":
// якщо в HTML щось змінять, буде зрозуміла помилка, а не undefined десь далі.
export function el<T extends Element>(
  root: ParentNode,
  selector: string,
  type: { new (): T; prototype: T },
): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`немає елемента ${selector}`);
  return found;
}
