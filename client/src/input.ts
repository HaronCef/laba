// Клавіатура через замикання: стан клавіш схований всередині createInput,
// ззовні до нього можна дістатись лише через повернені функції.

const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export interface Input {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  endStep(): void;
  destroy(): void;
}

export function createInput(target: Window = window): Input {
  const down = new Map<string, boolean>(); // code -> чи затиснута зараз
  const pressCount = new Map<string, number>(); // code -> скільки разів її натиснули
  let seenCount = new Map<string, number>(); // pressCount на момент кінця попереднього кроку

  function onKeyDown(event: KeyboardEvent): void {
    if (GAME_KEYS.includes(event.code)) {
      event.preventDefault(); // щоб сторінка не скролилась стрілками
    }
    if (!event.repeat) {
      pressCount.set(event.code, (pressCount.get(event.code) ?? 0) + 1);
    }
    down.set(event.code, true);
  }

  function onKeyUp(event: KeyboardEvent): void {
    down.set(event.code, false);
  }

  // якщо вікно втратило фокус, keyup може не прийти - відпускаємо все
  function onBlur(): void {
    down.clear();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    isDown: (code) => down.get(code) === true,
    // true, якщо з кінця попереднього кроку було нове натискання
    justPressed: (code) => (pressCount.get(code) ?? 0) !== (seenCount.get(code) ?? 0),
    // викликається в кінці кожного кроку симуляції
    endStep: () => {
      seenCount = new Map(pressCount);
    },
    destroy: () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
