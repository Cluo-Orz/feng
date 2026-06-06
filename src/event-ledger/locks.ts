import type { Result } from "../domain/result.js";

export class StreamLocks {
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, task: () => Promise<Result<T>>): Promise<Result<T>> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current);
    this.locks.set(key, next);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }
}
