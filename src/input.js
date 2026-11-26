

const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export function createInput(target = window) {
  const down = {}; 
  const pressCount = {}; 
  let seenCount = {}; 

  function onKeyDown(event) {
    if (GAME_KEYS.includes(event.code)) {
      event.preventDefault(); 
    }
    if (!event.repeat) {
      pressCount[event.code] = (pressCount[event.code] || 0) + 1;
    }
    down[event.code] = true;
  }

  function onKeyUp(event) {
    down[event.code] = false;
  }


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

  function justPressed(code) {
    return (pressCount[code] || 0) !== (seenCount[code] || 0);
  }

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
