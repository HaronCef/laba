// Клавіатура через замикання: стан клавіш схований всередині createInput,
// ззовні до нього можна дістатись лише через повернені функції.

const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export function createInput(target = window) {
  const down = {}; // code -> true, якщо клавіша зараз затиснута
  const pressCount = {}; // code -> скільки разів її натиснули за весь час
  let seenCount = {}; // pressCount на момент кінця попереднього кроку

  function onKeyDown(event) {
    if (GAME_KEYS.includes(event.code)) {
      event.preventDefault(); // щоб сторінка не скролилась стрілками
    }
    if (!event.repeat) {
      pressCount[event.code] = (pressCount[event.code] || 0) + 1;
    }
    down[event.code] = true;
  }

  function onKeyUp(event) {
    down[event.code] = false;
  }

  // якщо вікно втратило фокус, keyup може не прийти - відпускаємо все
  function onBlur() {
    for (const code in down) {
      down[code] = false;
    }
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  function isDown(code) {
    return down[code] === true;
  }

  // true, якщо з кінця попереднього кроку було нове натискання.
  // Навіть якщо клавішу натиснули і відпустили між кроками, натискання не загубиться.
  function justPressed(code) {
    return (pressCount[code] || 0) !== (seenCount[code] || 0);
  }

  // викликається в кінці кожного кроку симуляції
  function endStep() {
    seenCount = { ...pressCount };
  }

  function destroy() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
  }

  return { isDown, justPressed, endStep, destroy };
}
