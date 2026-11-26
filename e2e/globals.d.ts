// window.spaceDuel оголошено в client/src/game.ts; тут - лише те, що читає e2e-тест
export {};
declare global {
  interface Window {
    spaceDuel?: {
      net: {
        shipId: number | null;
        latest: { entities: Map<number, { x: number }> } | null;
      };
    };
  }
}
