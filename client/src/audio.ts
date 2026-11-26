import type { NetClient } from './net/netclient.ts';

// Звук через Web Audio. Симуляція про цей модуль нічого не знає:
// він сам підписується на події ("fired", "hit", "exploded", "pickup").

export interface Audio {
  readonly ctx: AudioContext;
  setBuffers(loaded: ReadonlyMap<string, AudioBuffer>): void;
  unlock(): void;
  toggleMute(): boolean;
  play(name: string, volume?: number): void;
  listenTo(net: NetClient): void;
}

export function createAudio(): Audio {
  // Браузер дозволяє грати звук лише після дії гравця (клік, клавіша),
  // тому контекст спочатку "suspended". Декодувати буфери це не заважає.
  const ctx = new AudioContext();
  let buffers: ReadonlyMap<string, AudioBuffer> = new Map();
  let muted = false;

  function play(name: string, volume = 0.5): void {
    const buffer = buffers.get(name); // Map.get може дати undefined - звуку могло не бути
    if (muted || !buffer || ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  return {
    ctx,
    setBuffers(loaded) {
      buffers = loaded;
    },
    // викликати з обробника кліку або клавіші
    unlock() {
      if (ctx.state === 'suspended') void ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    play,
    listenTo(net) {
      net.on('fired', (e) => play(e.missile ? 'missile' : 'shoot', 0.3));
      net.on('hit', () => play('hit', 0.5));
      net.on('exploded', (e) => play('explosion', e.kind === 'ship' ? 0.9 : 0.6));
      net.on('pickup', () => play('pickup', 0.5));
    },
  };
}
