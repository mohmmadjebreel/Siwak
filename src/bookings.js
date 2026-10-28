// Booking lifecycle: create (hold slot) → pay deposit → confirm + SMS.
import { getDoctor, getService } from './clinic.js';
import { transaction } from './db.js';
import { confirmationMessage, conflictMessage } from './messages.js';
import { pickDoctor } from './slots.js';
import { generateRef } from './util.js';

export class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getAppointment(db, ref) {
  return db.prepare('SELECT * FROM appointments WHERE ref = ?').get(ref) || null;
}

export function publicAppointment(appt) {
  const service = getService(appt.service_id);
  const doctor = getDoctor(appt.doctor_id);
  return {
    ref: appt.ref,
    status: appt.status,
    patientName: appt.patient_name,
    service: service ? { id: service.id, name: service.name, durationMin: service.durationMin } : null,
    doctor: doctor ? { id: doctor.id, name: doctor.name, title: doctor.title } : null,
    date: appt.date,
    time: appt.time,
    durationMin: appt.duration_min,
    deposit: appt.deposit_amount,
    currency: appt.currency,
    paidAt: appt.paid_at,
    holdExpiresAt: appt.status === 'pending_payment' ? appt.hold_expires_at : null,
  };
}

export function createAppointment(db, config, input) {
  const service = getService(input.serviceId);
  if (!service) throw new BookingError('الخدمة غير موجودة');

  return transaction(db, () => {
    // Limit concurrent unpaid holds per phone number.
    const pending = db
      .prepare(`SELECT COUNT(*) AS n FROM appointments WHERE phone = ? AND status = 'pending_payment' AND hold_expires_at > ?`)
      .get(input.phone, Date.now()).n;
    if (pending >= 2) throw new BookingError('لديك حجوزات بانتظار الدفع. أكمل الدفع أو انتظر انتهاء صلاحيتها.', 429);

    const doctorId = pickDoctor(db, {
      serviceId: service.id,
      doctorId: input.doctorId,
      date: input.date,
      time: input.time,
      timeZone: config.timezone,
    });
    if (!doctorId) throw new BookingError('عذراً، هذا الموعد لم يعد متاحاً. اختر وقتاً آخر.', 409);

    const now = Date.now();
    const ref = generateRef();
    db.prepare(
      `INSERT INTO appointments
        (ref, patient_name, phone, notes, service_id, doctor_id, date, time, duration_min, status,
         deposit_amount, currency, payment_provider, hold_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?)`,
    ).run(
      ref,
      input.name,
      input.phone,
      input.notes || null,
      service.id,
      doctorId,
      input.date,
      input.time,
      service.durationMin,
      service.deposit,
      config.currency,
      config.payment.provider,
      now + config.holdMinutes * 60_000,
      now,
      now,
    );
    return getAppointment(db, ref);
  });
}

/** Re-open an expired/pending hold so the patient can retry payment. */
export function refreshHold(db, config, appt) {
  return transaction(db, () => {
    const fresh = getAppointment(db, appt.ref);
    if (!['pending_payment', 'expired'].includes(fresh.status)) {
      throw new BookingError('لا يمكن الدفع لهذا الحجز', 409);
    }
    const free = pickDoctor(db, {
      serviceId: fresh.service_id,
      doctorId: fresh.doctor_id,
      date: fresh.date,
      time: fresh.time,
      timeZone: config.timezone,
      excludeId: fresh.id,
    });
    if (!free) {
      db.prepare(`UPDATE appointments SET status = 'expired', updated_at = ? WHERE id = ?`).run(Date.now(), fresh.id);
      throw new BookingError('انتهت مدة حجز هذا الموعد وأصبح محجوزاً لشخص آخر. يرجى اختيار موعد جديد.', 409);
    }
    const now = Date.now();
    db.prepare(
      `UPDATE appointments SET status = 'pending_payment', hold_expires_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now + config.holdMinutes * 60_000, now, fresh.id);
    return getAppointment(db, fresh.ref);
  });
}

export function setPaymentId(db, ref, paymentId) {
  db.prepare('UPDATE appointments SET payment_id = ?, updated_at = ? WHERE ref = ?').run(paymentId, Date.now(), ref);
}

/**
 * Mark a deposit as paid. Idempotent: only the first call transitions the booking and sends the SMS.
 * If the hold had lapsed and someone else took the slot, the booking is flagged `payment_conflict`
 * so the clinic can reschedule or refund.
 */
export async function markPaid(db, config, sms, ref, paymentId) {
  const result = transaction(db, () => {
    const appt = getAppointment(db, ref);
    if (!appt) return { appt: null, changed: false };
    if (!['pending_payment', 'expired'].includes(appt.status)) return { appt, changed: false };

    const stillFree = pickDoctor(db, {
      serviceId: appt.service_id,
      doctorId: appt.doctor_id,
      date: appt.date,
      time: appt.time,
      timeZone: config.timezone,
      excludeId: appt.id,
    });
    // A pending hold that's still alive owns its slot even if the start time has passed the lead window.
    const holdAlive = appt.status === 'pending_payment' && appt.hold_expires_at > Date.now();
    const status = stillFree || holdAlive ? 'confirmed' : 'payment_conflict';
    const now = Date.now();
    db.prepare(
      `UPDATE appointments SET status = ?, payment_id = COALESCE(?, payment_id), paid_at = ?, hold_expires_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(status, paymentId || null, now, now, appt.id);
    return { appt: getAppointment(db, ref), changed: true };
  });

  if (result.changed) {
    const { appt } = result;
    if (appt.status === 'confirmed') await sms.send(appt.phone, confirmationMessage(appt), 'confirmation');
    else await sms.send(appt.phone, conflictMessage(appt), 'conflict');
  }
  return result.appt;
}
