// Date/time helpers that work in the clinic's local timezone.
// Appointments are stored as local date ('YYYY-MM-DD') + local time ('HH:MM').

const DAY_MS = 86_400_000;

export function nowInZone(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isValidTime(time) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function dayNumber(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes from "now" (clinic local) until the given local date+time. Negative if in the past. */
export function minutesUntil(date, time, timeZone, at = new Date()) {
  const now = nowInZone(timeZone, at);
  return (dayNumber(date) - dayNumber(now.date)) * 1440 + toMinutes(time) - now.minutes;
}

export function formatDateAr(date) {
  return new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatTimeAr(time) {
  const minutes = toMinutes(time);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}
