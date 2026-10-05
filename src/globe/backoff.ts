/** Remembers failed loads so a snapshot that failed is retried after a pause, not on every frame. */
export class FailureBackoff<K> {
  private readonly until = new Map<K, number>();

  constructor(private readonly ms: number) {}

  fail(key: K): void {
    this.until.set(key, performance.now() + this.ms);
  }

  /** True while `key` failed less than `ms` ago. */
  blocked(key: K): boolean {
    const t = this.until.get(key);
    if (t === undefined) return false;
    if (performance.now() < t) return true;
    this.until.delete(key);
    return false;
  }
}
