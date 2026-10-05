/**
 * Table-of-contents drawer (left overlay): collapsible tree of all chapters with date ranges,
 * the current path highlighted and auto-expanded, importance-5 "landmark" events under their
 * section, and a search box filtering chapters by title (plus matching events; "/" focuses it).
 *
 * Opening never focuses the search box, so T still closes the drawer and Space still plays:
 * keyboard users land on the current chapter, everyone else on the drawer itself.
 */
import type { Chapter, HistoryEvent } from '../types';
import { CATEGORIES } from '../data/categories';
import { CHAPTERS, chapterAt } from '../data/index';
import { formatEventDate } from '../time/TimeModel';
import { chapterRange, type UIDeps } from './context';
import { h, isKeyboardModality, releaseFocus, type Disposer } from './dom';
import { icon } from './icons';
import { consensusBadge } from './badges';

interface NodeView {
  chapter: Chapter;
  el: HTMLElement;
  label: HTMLElement;
  caret: HTMLButtonElement | null;
  kids: NodeView[];
}

const MAX_EVENT_RESULTS = 40;

export interface TocDrawer {
  el: HTMLElement;
  /** Opens the drawer with the search box focused. */
  focusSearch(): void;
}

export function createTocDrawer(deps: UIDeps, d: Disposer): TocDrawer {
  const { store } = deps;
  const views = new Map<string, NodeView>();
  /** Expansion chosen by the user (and the auto-expanded current path); search shows its own. */
  const expanded = new Set<string>();

  // Landmarks hang under the deepest chapter containing them (always a leaf of the tree).
  const landmarks = new Map<string, HistoryEvent[]>();
  for (const e of deps.events) {
    if (e.importance !== 5) continue;
    const id = chapterAt(e.year).id;
    landmarks.set(id, [...(landmarks.get(id) ?? []), e]);
  }

  const eventRow = (e: HistoryEvent, withDate = true): HTMLElement => h('li', null,
    h('button', {
      class: `hoe-toc__event${e.consensus === 'fringe' ? ' is-fringe' : ''}`,
      type: 'button',
      style: { '--cat': CATEGORIES[e.category].color },
      onclick: () => {
        deps.player.jumpTo(e.year);
        deps.selectEvent(e.id, { fly: true });
      },
    },
    h('span', { class: 'hoe-toc__dot', 'aria-hidden': 'true' }),
    h('span', { class: 'hoe-toc__event-text' },
      h('span', { class: 'hoe-toc__event-title' }, e.title),
      withDate ? h('span', { class: 'hoe-toc__event-date' }, formatEventDate(e)) : null),
    consensusBadge(e.consensus)));

  const setOpen = (v: NodeView, open: boolean): void => {
    v.el.classList.toggle('is-open', open);
    v.caret?.setAttribute('aria-expanded', String(open));
  };

  const build = (c: Chapter): NodeView => {
    const kids = (c.children ?? []).map(build);
    const marks = landmarks.get(c.id) ?? [];
    const hasBody = kids.length > 0 || marks.length > 0;
    const label = h('span', { class: 'hoe-toc__title' }, c.title);
    const caret = hasBody
      // State-neutral name: aria-expanded tells whether the sub-chapters are showing.
      ? h('button', { class: 'hoe-toc__caret', type: 'button', 'aria-label': `${c.title} sub-chapters`, 'aria-expanded': 'false' }, icon('caret', 16))
      : null;
    const row = h('div', { class: 'hoe-toc__row' },
      caret ?? h('span', { class: 'hoe-toc__caret-spacer' }),
      h('button', {
        class: 'hoe-toc__jump', type: 'button',
        title: `Jump to ${c.title}`,
        onclick: () => deps.jumpToChapter(c),
      }, label, h('span', { class: 'hoe-toc__range' }, chapterRange(c))));
    const body = hasBody
      ? h('div', { class: 'hoe-toc__kids' },
        kids.map((k) => k.el),
        marks.length ? h('ul', { class: 'hoe-toc__landmarks', 'aria-label': 'Landmarks' }, marks.map((e) => eventRow(e, false))) : null)
      : null;
    const el = h('div', { class: `hoe-toc__node lvl-${c.level}` }, row, body);
    const view: NodeView = { chapter: c, el, label, caret, kids };
    caret?.addEventListener('click', () => {
      const open = !el.classList.contains('is-open');
      if (open) expanded.add(c.id); else expanded.delete(c.id);
      setOpen(view, open);
    });
    views.set(c.id, view);
    return view;
  };
  const roots = CHAPTERS.map(build);

  /* Search */
  const search = h('input', {
    class: 'hoe-toc__search', type: 'search', placeholder: 'Search chapters and events',
    'aria-label': 'Search chapters and events', autocomplete: 'off', spellcheck: 'false',
  });
  const results = h('ul', { class: 'hoe-toc__results' });
  const resultsWrap = h('section', { class: 'hoe-toc__results-wrap', hidden: true }, h('h3', null, 'Events'), results);
  const empty = h('p', { class: 'hoe-toc__empty', hidden: true }, 'No matches.');

  const highlight = (label: HTMLElement, title: string, q: string): void => {
    const i = q ? title.toLowerCase().indexOf(q) : -1;
    if (i < 0) label.textContent = title;
    else label.replaceChildren(title.slice(0, i), h('mark', null, title.slice(i, i + q.length)), title.slice(i + q.length));
  };

  const applySearch = (): void => {
    const q = search.value.trim().toLowerCase();
    // Shows a node if it, an ancestor or a descendant matches; opens only nodes leading to a match.
    const visit = (v: NodeView, ancestorMatch: boolean): boolean => {
      const self = q !== '' && v.chapter.title.toLowerCase().includes(q);
      let below = false;
      for (const k of v.kids) below = visit(k, ancestorMatch || self) || below;
      v.el.hidden = q !== '' && !(self || below || ancestorMatch);
      setOpen(v, q ? below : expanded.has(v.chapter.id));
      highlight(v.label, v.chapter.title, self ? q : '');
      return self || below;
    };
    const anyChapter = roots.map((r) => visit(r, false)).some(Boolean);
    if (!q) {
      resultsWrap.hidden = true;
      empty.hidden = true;
      return;
    }
    const keep = deps.filter();
    const hits = deps.events.filter((e) => keep(e) && e.title.toLowerCase().includes(q)).slice(0, MAX_EVENT_RESULTS);
    results.replaceChildren(...hits.map((e) => eventRow(e)));
    resultsWrap.hidden = hits.length === 0;
    empty.hidden = anyChapter || hits.length > 0;
  };
  let searchTimer = 0;
  d.listen(search, 'input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applySearch, 120);
  });
  d.add(() => window.clearTimeout(searchTimer));
  // Results honour the importance and fringe filters, so they follow the settings.
  d.add(store.on('settings', () => { if (search.value.trim()) applySearch(); }));

  /* Current path */
  let current: NodeView[] = [];
  const syncPath = (path: Chapter[]): void => {
    for (const v of current) v.el.classList.remove('is-current', 'is-here');
    current = path.map((c) => views.get(c.id)).filter((v): v is NodeView => v !== undefined);
    current.forEach((v, i) => {
      v.el.classList.add('is-current');
      if (i === current.length - 1) v.el.classList.add('is-here');
      // Auto-expand the ancestors of where we are (leaves stay as the user left them).
      if (i < current.length - 1) {
        expanded.add(v.chapter.id);
        if (!search.value.trim()) setOpen(v, true);
      }
    });
  };
  d.add(deps.path.on(syncPath));
  syncPath(deps.path.get());

  const tree = h('div', { class: 'hoe-toc__tree' }, roots.map((r) => r.el), empty, resultsWrap);
  // tabindex -1: the drawer itself takes focus when opened by mouse or touch (see syncOpen).
  const el = h('nav', { class: 'hoe-toc', 'aria-label': 'Contents', tabindex: -1 },
    h('div', { class: 'hoe-toc__head' },
      h('h2', null, 'Contents'),
      h('button', {
        class: 'hoe-btn hoe-btn--icon', type: 'button', 'aria-label': 'Close contents (Esc)', title: 'Close (Esc)',
        onclick: () => store.set({ tocOpen: false }),
      }, icon('close'))),
    h('div', { class: 'hoe-toc__searchbox' }, icon('search', 16), search),
    tree);

  /** Where focus goes back on close: the opener, for keyboard users only. */
  let returnFocus: HTMLElement | null = null;
  const syncOpen = (open: boolean): void => {
    el.classList.toggle('is-open', open);
    // On :root so that both the controls (controls.css) and the globe's credit strip
    // (src/app/shell.css), which is outside the UI overlay, can make room for the drawer.
    document.documentElement.classList.toggle('hoe-toc-open', open);
    if (!open) {
      releaseFocus(el, returnFocus);
      el.inert = true;
      return;
    }
    el.inert = false;
    const active = document.activeElement;
    returnFocus = isKeyboardModality() && active instanceof HTMLElement ? active : null;
    const here = current.at(-1)?.el.querySelector<HTMLElement>('.hoe-toc__jump');
    here?.scrollIntoView({ block: 'center' });
    if (returnFocus && here) here.focus({ preventScroll: true });
    else el.focus({ preventScroll: true });
  };
  d.add(store.on('tocOpen', syncOpen));
  d.add(() => document.documentElement.classList.remove('hoe-toc-open'));
  syncOpen(store.get().tocOpen);

  return {
    el,
    focusSearch() {
      store.set({ tocOpen: true });
      search.focus({ preventScroll: true });
      search.select();
    },
  };
}
