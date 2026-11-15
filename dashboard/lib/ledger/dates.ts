const DAY = 86_400_000;

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const toDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => toDay(Date.parse(`${day}T00:00:00Z`) + n * DAY);
export const compareDates = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `Today`, `Yesterday`, or `Nov 3`. */
export function shortDate(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [, m, d] = day.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** The last `n` days ending on `today`, newest first, with weekday names: the reader's calendar. */
export function calendar(today: string, n = 14): string[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, -i);
    return `${day} ${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}`;
  });
}
