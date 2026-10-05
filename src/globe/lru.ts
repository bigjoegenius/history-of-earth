/** Map with least-recently-used eviction; `onEvict` lets owners free GPU/bitmap memory. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number, private readonly onEvict?: (value: V, key: K) => void) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const [oldKey, oldValue] = this.map.entries().next().value as [K, V];
      this.map.delete(oldKey);
      this.onEvict?.(oldValue, oldKey);
    }
  }

  clear(): void {
    for (const [k, v] of this.map) this.onEvict?.(v, k);
    this.map.clear();
  }
}
