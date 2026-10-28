import express from 'express';
import { clinic, getDoctor, getService } from '../clinic.js';
import { BookingError, createAppointment, getAppointment, publicAppointment, refreshHold } from '../bookings.js';
import { otpMessage } from '../messages.js';
import { bookingDates, doctorsForService, getAvailability } from '../slots.js';
import { signToken, verifyToken } from '../security.js';
import { isValidDate, isValidTime } from '../time.js';
import { cleanText, generateOtp, isAllowedPhone, maskPhone, normalizePhone, sha256 } from '../util.js';

const OTP_TTL_MS = 10 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const PHONE_ERROR = 'يرجى إدخال رقم جوال فلسطيني صحيح يبدأ بـ 059 أو 056 (مثال: 0597736062)';

export function publicRoutes({ db, config, sms, allow, startCheckout, viewToken }) {
  const router = express.Router();
  const hashCode = (phone, code) => sha256(`${phone}:${code}:${config.sessionSecret}`);

  const requireView = (req) => {
    const appt = getAppointment(db, String(req.params.ref || ''));
    const token = verifyToken(config.sessionSecret, String(req.query.t || req.body?.t || ''));
    if (!appt || !token || token.ref !== appt.ref) throw new BookingError('الحجز غير موجود', 404);
    return appt;
  };

  router.get('/clinic', (req, res) => {
    res.json({
      name: clinic.name,
      fullName: clinic.fullName,
      tagline: clinic.tagline,
      phone: clinic.phone,
      whatsapp: clinic.whatsapp,
      email: clinic.email,
      address: clinic.address,
      mapUrl: clinic.mapUrl,
      hours: clinic.hours,
      cancelHours: clinic.cancelHours,
      currency: config.currency,
      holdMinutes: config.holdMinutes,
      paymentProvider: config.payment.provider,
      services: clinic.services,
      doctors: clinic.doctors.map(({ id, name, title, services, days }) => ({ id, name, title, services, days })),
      dates: bookingDates(config.timezone),
    });
  });

  router.get('/slots', (req, res) => {
    const serviceId = String(req.query.serviceId || '');
    const doctorId = String(req.query.doctorId || 'any');
    const date = String(req.query.date || '');
    if (!getService(serviceId) || !isValidDate(date)) throw new BookingError('طلب غير صالح');
    if (doctorId !== 'any' && !doctorsForService(serviceId).some((d) => d.id === doctorId)) {
      throw new BookingError('الطبيب لا يقدّم هذه الخدمة');
    }
    const slots = getAvailability(db, { serviceId, doctorId, date, timeZone: config.timezone });
    res.json({ date, slots: slots.map((s) => s.time) });
  });

  router.post('/otp/send', async (req, res) => {
    const phone = normalizePhone(req.body?.phone, config.defaultCountryCode);
    if (!isAllowedPhone(phone, config.allowedPhonePrefixes)) throw new BookingError(PHONE_ERROR);
    if (!allow(`otp-ip:${req.ip}`, 10, 3_600_000)) throw new BookingError('محاولات كثيرة، حاول لاحقاً', 429);

    const now = Date.now();
    const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
    if (row && now - row.last_sent_at < OTP_RESEND_MS) {
      const wait = Math.ceil((OTP_RESEND_MS - (now - row.last_sent_at)) / 1000);
      return res.status(429).json({ error: `انتظر ${wait} ثانية قبل إعادة الإرسال`, retryAfter: wait });
    }
    const inWindow = row && now - row.window_start < 3_600_000;
    if (inWindow && row.sent_count >= OTP_MAX_PER_HOUR) {
      throw new BookingError('تجاوزت عدد مرات الإرسال المسموح. حاول بعد ساعة.', 429);
    }

    const code = generateOtp();
    db.prepare(
      `INSERT INTO otps (phone, code_hash, expires_at, attempts, sent_count, window_start, last_sent_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         attempts = 0, sent_count = excluded.sent_count, window_start = excluded.window_start, last_sent_at = excluded.last_sent_at`,
    ).run(phone, hashCode(phone, code), now + OTP_TTL_MS, inWindow ? row.sent_count + 1 : 1, inWindow ? row.window_start : now, now);

    const ok = await sms.send(phone, otpMessage(code), 'otp');
    if (!ok) throw new BookingError('تعذّر إرسال الرسالة. تأكد من الرقم وحاول مجدداً.', 502);
    res.json({ ok: true, phone: maskPhone(phone), resendAfter: OTP_RESEND_MS / 1000 });
  });

  router.post('/otp/verify', (req, res) => {
    const phone = normalizePhone(req.body?.phone, config.defaultCountryCode);
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (!isAllowedPhone(phone, config.allowedPhonePrefixes)) throw new BookingError(PHONE_ERROR);
    if (code.length !== 6) throw new BookingError('الرمز غير صحيح');

    const row = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
    if (!row || row.expires_at < Date.now()) throw new BookingError('انتهت صلاحية الرمز، اطلب رمزاً جديداً');
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw new BookingError('محاولات خاطئة كثيرة، اطلب رمزاً جديداً', 429);

    if (row.code_hash !== hashCode(phone, code)) {
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?').run(phone);
      throw new BookingError('الرمز غير صحيح');
    }
    db.prepare('UPDATE otps SET expires_at = 0 WHERE phone = ?').run(phone);
    res.json({ ok: true, verifyToken: signToken(config.sessionSecret, { phone, purpose: 'book' }, 30 * 60) });
  });

  router.post('/appointments', async (req, res) => {
    const body = req.body || {};
    const token = verifyToken(config.sessionSecret, String(body.verifyToken || ''));
    if (!token || token.purpose !== 'book') throw new BookingError('يرجى تأكيد رقم الجوال أولاً', 401);

    const name = cleanText(body.name, 60);
    const notes = cleanText(body.notes, 300);
    const serviceId = String(body.serviceId || '');
    const doctorId = String(body.doctorId || 'any');
    const date = String(body.date || '');
    const time = String(body.time || '');

    if (name.length < 2) throw new BookingError('يرجى كتابة الاسم');
    if (!getService(serviceId)) throw new BookingError('اختر الخدمة');
    if (doctorId !== 'any' && !getDoctor(doctorId)) throw new BookingError('الطبيب غير موجود');
    if (!isValidDate(date) || !isValidTime(time)) throw new BookingError('اختر التاريخ والوقت');
    if (body.agree !== true) throw new BookingError('يرجى الموافقة على سياسة العربون');
    if (!allow(`book-ip:${req.ip}`, 20, 3_600_000)) throw new BookingError('محاولات كثيرة، حاول لاحقاً', 429);

    const appt = createAppointment(db, config, { name, notes, serviceId, doctorId, date, time, phone: token.phone });
    const t = viewToken(appt.ref);
    const redirectUrl = await startCheckout(appt);
    res.status(201).json({ ref: appt.ref, t, redirectUrl, appointment: publicAppointment(appt) });
  });

  router.get('/appointments/:ref', (req, res) => {
    let appt = requireView(req);
    // Surface lapsed holds immediately rather than waiting for the scheduler tick.
    if (appt.status === 'pending_payment' && appt.hold_expires_at < Date.now()) {
      db.prepare(`UPDATE appointments SET status = 'expired', updated_at = ? WHERE id = ?`).run(Date.now(), appt.id);
      appt = getAppointment(db, appt.ref);
    }
    res.json({ appointment: publicAppointment(appt), cancelHours: clinic.cancelHours, clinicPhone: clinic.phone });
  });

  router.post('/appointments/:ref/pay', async (req, res) => {
    const appt = refreshHold(db, config, requireView(req));
    res.json({ redirectUrl: await startCheckout(appt) });
  });

  return router;
}
