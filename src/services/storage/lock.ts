/** Serializes operations per prison id inside this process, so concurrent edits cannot interleave. */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  isLocked(key: string): boolean { return this.tails.has(key); }

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
