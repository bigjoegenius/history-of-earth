/**
 * Wikipedia REST summaries (CORS-enabled, no key). Promises are cached in memory per title so a card
 * opened twice costs one request; 404s are cached as "no summary", network failures are not
 * (so going back online helps on the next open).
 */
export interface WikiSummary {
  extract: string;
  url: string;
  thumbnail?: { source: string; width: number; height: number };
}

interface RawSummary {
  type?: string;
  extract?: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls?: { desktop?: { page?: string } };
}

const API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const cache = new Map<string, Promise<WikiSummary | null>>();

const pathFor = (title: string): string => encodeURIComponent(title.replace(/ /g, '_'));

export function wikiUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${pathFor(title)}`;
}

export function fetchWikiSummary(title: string): Promise<WikiSummary | null> {
  let p = cache.get(title);
  if (!p) {
    p = load(title);
    cache.set(title, p);
  }
  return p;
}

async function load(title: string): Promise<WikiSummary | null> {
  try {
    const res = await fetch(API + pathFor(title));
    if (!res.ok) {
      if (res.status !== 404) cache.delete(title); // transient (429/5xx): retry next time
      return null;
    }
    const raw = (await res.json()) as RawSummary;
    if (raw.type === 'disambiguation' || !raw.extract) return null;
    return { extract: raw.extract, url: raw.content_urls?.desktop?.page ?? wikiUrl(title), thumbnail: raw.thumbnail };
  } catch {
    cache.delete(title); // offline or blocked
    return null;
  }
}
