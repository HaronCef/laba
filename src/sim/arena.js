// Арена: розміри і "загортання" країв (вилетів справа - з'явився зліва)

export function createArena(width, height) {
  return { width, height };
}

// повертає value в межах [0, max), працює і для від'ємних чисел
export function wrapValue(value, max) {
  return ((value % max) + max) % max;
}

export function wrapShip(ship, arena) {
  return {
    ...ship,
    x: wrapValue(ship.x, arena.width),
    y: wrapValue(ship.y, arena.height),
  };
}
