// Background jobs: release lapsed slot holds and send day-before reminders.
import { reminderMessage } from './messages.js';
import { minutesUntil } from './time.js';

export function expireHolds(db) {
  return db
    .prepare(`UPDATE appointments SET status = 'expired', updated_at = ? WHERE status = 'pending_payment' AND hold_expires_at < ?`)
    .run(Date.now(), Date.now()).changes;
}

export async function sendReminders(db, config, sms) {
  const candidates = db
    .prepare(`SELECT * FROM appointments WHERE status = 'confirmed' AND reminder_sent = 0`)
    .all();
  let sent = 0;
  for (const appt of candidates) {
    const until = minutesUntil(appt.date, appt.time, config.timezone);
    if (until > 24 * 60) continue;
    // Booked very recently or already started: the confirmation SMS is enough.
    const bookedRecently = appt.paid_at && Date.now() - appt.paid_at < 6 * 3_600_000;
    const markSent = () => db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
    if (until < 60 || bookedRecently) {
      markSent();
      continue;
    }
    markSent();
    if (await sms.send(appt.phone, reminderMessage(appt), 'reminder')) sent += 1;
  }
  return sent;
}

export function startScheduler(db, config, sms, intervalMs = 60_000) {
  const tick = async () => {
    try {
      expireHolds(db);
      await sendReminders(db, config, sms);
    } catch (err) {
      console.error('[scheduler]', err);
    }
  };
  tick();
  return setInterval(tick, intervalMs).unref();
}
