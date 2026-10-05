/**
 * Year formatting and calendar helpers (see SPEC.md "Year convention").
 *
 * Years are one continuous number: positive CE, negative BCE, deep time as large negatives.
 * A calendar year n covers [n, n + 1), so fractional years are floored to find the year label
 * (−3500.3 lies in 3501 BCE). Year 0 has no label of its own and is shown as 1 BCE.
 */
import type { HistoryEvent, Year } from '../types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Tolerance (in months) when splitting a fractional year into a month. Authors write
 * "start of August" as year + 7/12 rounded to two decimals (1914.58 = 1914.5833…), which is up to
 * 0.04 months early; without the nudge such dates would show the previous month.
 */
const MONTH_EPSILON = 0.05;

/** Guards calendar-year flooring against float noise (1492 − 1e-12 must still read "1492"). */
const YEAR_EPSILON = 1e-6;

/** Below this (i.e. more than ~10,000 years ago) dates are shown as "… years ago". */
const DEEP_TIME_LIMIT = -10_000;

/** Fractional current calendar year from the system clock, e.g. 2026.75 in early October 2026. */
export function presentYear(): Year {
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (now.getTime() - start) / (end - start);
}

/** Years between y and now (positive for the past). */
export function yearsAgo(y: Year): number {
  return presentYear() - y;
}

/**
 * Splits a fractional year into calendar year and month (0–11). Works for negative years too.
 * The month nudge never crosses into the next year (late December stays December).
 */
export function yearToMonthFraction(y: Year): { year: number; month: number } {
  const year = Math.floor(y + YEAR_EPSILON);
  const month = Math.floor((y - year) * 12 + MONTH_EPSILON);
  return { year, month: Math.max(0, Math.min(11, month)) };
}

/* ───────────── number helpers ───────────── */

function roundSig3(x: number): number {
  return Number(x.toPrecision(3));
}

/** Fixed decimals with trailing zeros (and a dangling point) removed: 4.50 → "4.5", 66.0 → "66". */
function trimFixed(x: number, decimals: number): string {
  return x.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** "300000" → "300,000" (fixed en-US style; avoids locale-dependent output). */
function withSeparators(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Magnitude in billions/millions/plain with the SPEC precision: "4.54 billion", "2.6 million", "12,000". */
function magnitudeWords(x: number): string {
  const r = roundSig3(x);
  if (r >= 1e9) return `${trimFixed(r / 1e9, 2)} billion`;
  if (r >= 1e6) return `${trimFixed(r / 1e6, 1)} million`;
  return withSeparators(r);
}

/* ───────────── calendar labels ───────────── */

/** Integer calendar year label for a (possibly fractional) year: 1492, 476 CE, 3,500 BCE. */
function calendarLabel(calendarYear: number, separators: boolean): string {
  if (calendarYear >= 1000) return String(calendarYear);
  if (calendarYear >= 1) return `${calendarYear} CE`;
  const bce = Math.max(1, -calendarYear); // year 0 → 1 BCE
  return `${separators ? withSeparators(bce) : bce} BCE`;
}

/**
 * Display string for a year (SPEC "Year convention"):
 * "4.54 billion years ago" · "66 million years ago" · "12,000 years ago" · "3,500 BCE" · "476 CE" · "1492".
 * With `{ month: true }` calendar dates gain the month ("August 1914", "March 44 BCE"); deep time ignores it.
 */
export function formatYear(y: Year, opts?: { month?: boolean }): string {
  if (y <= DEEP_TIME_LIMIT) return `${magnitudeWords(yearsAgo(y))} years ago`;
  if (opts?.month) {
    const { year, month } = yearToMonthFraction(y);
    return `${MONTHS[month]} ${calendarLabel(year, true)}`;
  }
  return calendarLabel(Math.floor(y + YEAR_EPSILON), true);
}

/** True when y carries a meaningful fraction of a year (i.e. encodes a month). */
function hasFraction(y: Year): boolean {
  return Math.abs(y - Math.round(y)) > YEAR_EPSILON;
}

/**
 * Compact tick label (≤ 8 characters where possible): "4.5 Ga", "66 Ma", "300 ka", "3500 BCE", "476 CE", "1492".
 * Unlike formatYear, Ga/Ma/ka are measured from year 0 rather than from today, so ticks placed at round
 * year values get round labels (the ~2,000-year offset is invisible at those scales).
 */
export function formatYearShort(y: Year): string {
  const before = -y;
  if (before >= 1e9) return `${trimFixed(before / 1e9, 3)} Ga`;
  if (before >= 1e6) return `${trimFixed(before / 1e6, 2)} Ma`;
  if (y <= DEEP_TIME_LIMIT) return `${trimFixed(before / 1e3, 2)} ka`;
  if (hasFraction(y)) {
    // Sub-year ticks (detail ruler zoomed into a few years): "Aug 1914".
    const { year, month } = yearToMonthFraction(y);
    return `${MONTHS[month].slice(0, 3)} ${calendarLabel(year, false)}`;
  }
  return calendarLabel(Math.round(y), false);
}

/** Human duration: "2.3 billion years", "66 million years", "12,000 years", "150 years", "1 year", "6 months". */
export function formatDuration(years: number): string {
  const y = Math.abs(years);
  if (y < 1) {
    const months = Math.round(y * 12);
    if (months >= 1) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const days = Math.round(y * 365.25);
    return days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'less than a day';
  }
  const r = roundSig3(y);
  if (r >= 1000) return `${magnitudeWords(y)} years`;
  const text = trimFixed(r, 1);
  return `${text} ${text === '1' ? 'year' : 'years'}`;
}

/** Suffixes that both ends of a span may share; the first end then drops it ("3,100 – 2,686 BCE"). */
const SHARED_SUFFIXES = [' billion years ago', ' million years ago', ' years ago', ' BCE', ' CE'];

/** Card date: the author's dateLabel, else formatYear (with month when the year encodes one), "start – end" for spans. */
export function formatEventDate(e: HistoryEvent): string {
  if (e.dateLabel) return e.dateLabel;
  const fmt = (y: Year) => formatYear(y, { month: y > DEEP_TIME_LIMIT && hasFraction(y) });
  const start = fmt(e.year);
  if (e.endYear === undefined) return start;
  const end = fmt(e.endYear);
  if (start === end) return start;
  // Both stems must be bare numbers, otherwise " years ago" would also match "2.6 million years ago".
  const isNumber = (s: string) => /^[\d.,]+$/.test(s);
  const suffix = SHARED_SUFFIXES.find((s) =>
    start.endsWith(s) && end.endsWith(s) && isNumber(start.slice(0, -s.length)) && isNumber(end.slice(0, -s.length)));
  return suffix ? `${start.slice(0, -suffix.length)} – ${end}` : `${start} – ${end}`;
}

/** Tick step on the 1-2-5 progression giving at most ~targetTicks ticks over span (span 1000, 10 → 100). */
export function niceTickStep(span: number, targetTicks: number): number {
  const raw = Math.abs(span) / Math.max(1, targetTicks);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  // Tolerance keeps float noise (e.g. 2.9999999999999996) from bumping to the next step.
  const nice = [1, 2, 5, 10].find((n) => normalized <= n * (1 + 1e-9)) ?? 10;
  return nice * magnitude;
}
