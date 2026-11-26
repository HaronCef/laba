// Типізована шина подій. E - "карта" подій: назва -> що передається.
// K extends keyof E: назва може бути лише одна з ключів E,
// а E[K] - тип даних саме цієї події. Тому bus.emit('score', 'текст') - помилка tsc,
// а в bus.on('score', e => ...) TypeScript знає, які поля має e.
export class Bus<E extends Record<string, unknown>> {
  readonly #handlers: { [K in keyof E]?: Array<(payload: E[K]) => void> } = {};

  on<K extends keyof E>(name: K, handler: (payload: E[K]) => void): () => void {
    const list = this.#handlers[name] ?? [];
    list.push(handler);
    this.#handlers[name] = list;
    return () => {
      this.#handlers[name] = (this.#handlers[name] ?? []).filter((h) => h !== handler);
    };
  }

  // одна подія як проміс (подія -> проміс, як у лабі 3)
  once<K extends keyof E>(name: K): Promise<E[K]> {
    return new Promise((resolve) => {
      const off = this.on(name, (payload) => {
        off();
        resolve(payload);
      });
    });
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    for (const handler of this.#handlers[name] ?? []) handler(payload);
  }
}
