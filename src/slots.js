import { clinic, getService } from './clinic.js';
import { addDays, dayNumber, fromMinutes, isValidDate, nowInZone, toMinutes, weekday } from './time.js';

// Appointments in these states occupy their slot (pending ones only while the hold is alive).
const BLOCKING_SQL = `
  SELECT id, time, duration_min FROM appointments
  WHERE doctor_id = ? AND date = ?
    AND (status IN ('confirmed', 'completed', 'no_show')
         OR (status = 'pending_payment' AND hold_expires_at > ?))
`;

export function doctorsForService(serviceId) {
  return clinic.doctors.filter((d) => d.services.includes(serviceId));
}

/** Is the given date bookable at all (inside the window, clinic open)? */
export function isDateOpen(date, timeZone) {
  if (!isValidDate(date)) return false;
  const today = nowInZone(timeZone).date;
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0 || diff > clinic.bookingWindowDays) return false;
  return (clinic.hours[weekday(date)] || []).length > 0;
}

/** List the bookable dates in the window with an `open` flag. */
export function bookingDates(timeZone) {
  const today = nowInZone(timeZone).date;
  const out = [];
  for (let i = 0; i <= clinic.bookingWindowDays; i++) {
    const date = addDays(today, i);
    out.push({ date, open: (clinic.hours[weekday(date)] || []).length > 0 });
  }
  return out;
}

function busyIntervals(db, doctorId, date, excludeId) {
  return db
    .prepare(BLOCKING_SQL)
    .all(doctorId, date, Date.now())
    .filter((r) => r.id !== excludeId)
    .map((r) => [toMinutes(r.time), toMinutes(r.time) + r.duration_min]);
}

function overlaps(start, end, intervals) {
  return intervals.some(([s, e]) => start < e && s < end);
}

/**
 * Available start times for a service on a date.
 * Returns [{ time: 'HH:MM', doctorIds: [...] }] sorted by time.
 */
export function getAvailability(db, { serviceId, doctorId = 'any', date, timeZone, excludeId = null }) {
  const service = getService(serviceId);
  if (!service || !isDateOpen(date, timeZone)) return [];

  const day = weekday(date);
  const now = nowInZone(timeZone);
  const isToday = now.date === date;
  const earliest = isToday ? now.minutes + clinic.minLeadMinutes : -1;

  let doctors = doctorsForService(serviceId).filter((d) => d.days.includes(day));
  if (doctorId && doctorId !== 'any') doctors = doctors.filter((d) => d.id === doctorId);

  const byTime = new Map();
  for (const doctor of doctors) {
    const busy = busyIntervals(db, doctor.id, date, excludeId);
    for (const [open, close] of clinic.hours[day] || []) {
      const end = toMinutes(close);
      for (let t = toMinutes(open); t + service.durationMin <= end; t += clinic.slotMinutes) {
        if (t < earliest) continue;
        if (overlaps(t, t + service.durationMin, busy)) continue;
        const key = fromMinutes(t);
        if (!byTime.has(key)) byTime.set(key, []);
        byTime.get(key).push(doctor.id);
      }
    }
  }

  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, doctorIds]) => ({ time, doctorIds }));
}

/** Returns the doctor id that can take this slot, or null. */
export function pickDoctor(db, { serviceId, doctorId, date, time, timeZone, excludeId = null }) {
  const slot = getAvailability(db, { serviceId, doctorId, date, timeZone, excludeId }).find((s) => s.time === time);
  if (!slot) return null;
  if (doctorId && doctorId !== 'any') return slot.doctorIds.includes(doctorId) ? doctorId : null;
  // "Any doctor": pick the one with the fewest bookings that day to spread the load.
  const counts = slot.doctorIds.map((id) => ({
    id,
    n: db
      .prepare(`SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND date = ? AND status IN ('confirmed','pending_payment')`)
      .get(id, date).n,
  }));
  counts.sort((a, b) => a.n - b.n);
  return counts[0].id;
}
