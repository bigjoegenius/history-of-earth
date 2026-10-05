/** Minimal observable value: subscribers fire only when `equals` reports a change. */
export class Signal<T> {
  private readonly fns = new Set<(v: T) => void>();

  constructor(private value: T, private readonly equals: (a: T, b: T) => boolean = Object.is) {}

  get(): T {
    return this.value;
  }

  set(v: T): void {
    if (this.equals(this.value, v)) return;
    this.value = v;
    for (const fn of this.fns) fn(v);
  }

  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
}
