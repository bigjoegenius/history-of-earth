import type { AppState, Settings, Speed, Year } from '../types';
import { TIMELINE_START, PRESENT_YEAR } from '../types';

type Listener<T> = (value: T, prev: T) => void;
type KeyListener = Partial<Record<keyof AppState, Set<Listener<any>>>>;

export const DEFAULT_SETTINGS: Settings = {
  highResImagery: true,
  lighting: false,
  showBorders: true,
  showLabels: true,
  showMarkers: true,
  showFringe: true,
  minImportance: 1,
  tour: false,
};

export const SPEEDS: Speed[] = [0.1, 0.25, 0.5, 1, 2, 4, 10, 25, 100];

/**
 * Minimal reactive store. Modules read with `store.get()` and react with `store.on('year', cb)`.
 * Listeners fire synchronously after `set()`; only changed keys notify.
 */
export class Store {
  private state: AppState;
  private keyListeners: KeyListener = {};
  private anyListeners = new Set<Listener<AppState>>();

  constructor(initial?: Partial<AppState>) {
    this.state = {
      year: TIMELINE_START,
      playing: false,
      speed: 1,
      direction: 1,
      selectedEventId: null,
      visibleEventIds: [],
      chapterPath: [],
      detailRange: [TIMELINE_START, PRESENT_YEAR],
      tocOpen: false,
      settings: { ...DEFAULT_SETTINGS },
      ...initial,
    };
  }

  get(): Readonly<AppState> {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    const changed = (Object.keys(patch) as (keyof AppState)[]).filter((k) => patch[k] !== prev[k]);
    if (changed.length === 0) return;
    this.state = { ...prev, ...patch };
    for (const k of changed) {
      const set = this.keyListeners[k];
      if (set) for (const fn of set) fn(this.state[k], prev[k]);
    }
    for (const fn of this.anyListeners) fn(this.state, prev);
  }

  setSettings(patch: Partial<Settings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }

  on<K extends keyof AppState>(key: K, fn: Listener<AppState[K]>): () => void {
    const set = (this.keyListeners[key] ??= new Set()) as Set<Listener<any>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  onAny(fn: Listener<AppState>): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  setYear(year: Year): void {
    this.set({ year: Math.min(PRESENT_YEAR, Math.max(TIMELINE_START, year)) });
  }
}
