import { describe, expect, it } from 'vitest';
import { LatestOnly } from './latestOnly';
import { LruCache } from './lru';

describe('LatestOnly', () => {
  it('runs one job at a time and skips superseded ones', async () => {
    const ran: number[] = [];
    let release: () => void = () => {};
    const loader = new LatestOnly<number>(async (n) => {
      ran.push(n);
      await new Promise<void>((r) => { release = r; });
    });
    loader.push(1);
    loader.push(2);
    loader.push(3); // 2 is dropped: 3 replaced it before it started
    release();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual([1, 3]);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (_v, k) => evicted.push(k));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(cache.has('a') && cache.has('c')).toBe(true);
  });
});
