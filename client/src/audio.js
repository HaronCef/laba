// Звук через Web Audio. Симуляція про цей модуль нічого не знає:
// він сам підписується на події світу ("fired", "hit", "exploded", "pickup").

export function createAudio() {
  // Браузер дозволяє грати звук лише після дії гравця (клік, клавіша),
  // тому контекст спочатку "suspended". Декодувати буфери це не заважає.
  const ctx = new AudioContext();
  let buffers = {};
  let muted = false;

  function setBuffers(loaded) {
    buffers = loaded;
  }

  // викликати з обробника кліку або клавіші
  function unlock() {
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  function play(name, volume = 0.5) {
    const buffer = buffers[name];
    if (muted || !buffer || ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  function listenTo(world) {
    world.addEventListener('fired', (e) =>
      play(e.detail.missile ? 'missile' : 'shoot', 0.3),
    );
    world.addEventListener('hit', () => play('hit', 0.5));
    world.addEventListener('exploded', (e) =>
      play('explosion', e.detail.kind === 'ship' ? 0.9 : 0.6),
    );
    world.addEventListener('pickup', () => play('pickup', 0.5));
  }

  return { ctx, setBuffers, unlock, toggleMute, play, listenTo };
}
