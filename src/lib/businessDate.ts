/**
 * Calendar-only fields (@db.Date) — use one canonical instant so find/create/analytics agree (avoids P2002 / missed findUnique).
 */
export function parseYmd(dateStr: string): { y: number; mo: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (!y || !mo || !day) return null;
  return { y, mo, day };
}

/** UTC noon for the given calendar day — stable in Prisma + MySQL DATE. */
export function businessDateUtcNoon(y: number, mo: number, day: number): Date {
  return new Date(Date.UTC(y, mo - 1, day, 12, 0, 0, 0));
}

export function businessDateFromYmdString(dateStr: string): Date | null {
  const p = parseYmd(dateStr);
  if (!p) return null;
  return businessDateUtcNoon(p.y, p.mo, p.day);
}

/** UTC midnight→end for filtering timestamps (e.g. supplier deliveries) to a calendar YYYY-MM-DD. */
export function utcDayRangeInclusive(ymd: string): { start: Date; end: Date } | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const start = new Date(Date.UTC(p.y, p.mo - 1, p.day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(p.y, p.mo - 1, p.day, 23, 59, 59, 999));
  return { start, end };
}

/** Calendar YYYY-MM-DD in UTC from a Prisma @db.Date / JS Date. */
export function dateToYmdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}
