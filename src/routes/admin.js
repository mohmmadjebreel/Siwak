import express from 'express';
import { clinic } from '../clinic.js';
import { BookingError, getAppointment, publicAppointment } from '../bookings.js';
import { cancellationMessage } from '../messages.js';
import { parseCookies, signToken, verifyToken } from '../security.js';
import { isValidDate, nowInZone } from '../time.js';
import { safeEqual } from '../util.js';

const COOKIE = 'siwak_admin';
const SESSION_TTL = 12 * 3600;

// Allowed status changes from the dashboard.
const TRANSITIONS = {
  pending_payment: ['cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  payment_conflict: ['confirmed', 'cancelled'],
  no_show: ['completed'],
};

export function adminRoutes({ db, config, sms, allow }) {
  const router = express.Router();

  const isAdmin = (req) => {
    const token = verifyToken(config.sessionSecret, parseCookies(req.headers.cookie)[COOKIE]);
    return token?.role === 'admin';
  };

  const requireAdmin = (req, res, next) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'يرجى تسجيل الدخول' });
    // CSRF guard: state-changing requests must be JSON (cannot be sent cross-site without CORS preflight).
    if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Unsupported' });
    next();
  };

  router.post('/login', (req, res) => {
    if (!allow(`login:${req.ip}`, 10, 15 * 60_000)) throw new BookingError('محاولات كثيرة، حاول بعد 15 دقيقة', 429);
    if (!safeEqual(String(req.body?.password || ''), config.adminPassword)) {
      throw new BookingError('كلمة المرور غير صحيحة', 401);
    }
    const token = signToken(config.sessionSecret, { role: 'admin' }, SESSION_TTL);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}${req.secure ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => res.json({ loggedIn: isAdmin(req) }));

  router.use(requireAdmin);

  router.get('/stats', (req, res) => {
    const today = nowInZone(config.timezone).date;
    const monthStart = `${today.slice(0, 7)}-01`;
    const one = (sql, ...args) => db.prepare(sql).get(...args);
    res.json({
      today,
      todayCount: one(`SELECT COUNT(*) AS n FROM appointments WHERE date = ? AND status IN ('confirmed','completed','no_show')`, today).n,
      upcoming: one(`SELECT COUNT(*) AS n FROM appointments WHERE date >= ? AND status = 'confirmed'`, today).n,
      pending: one(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'pending_payment' AND hold_expires_at > ?`, Date.now()).n,
      conflicts: one(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'payment_conflict'`).n,
      depositsMonth: one(
        `SELECT COALESCE(SUM(deposit_amount), 0) AS s FROM appointments WHERE paid_at IS NOT NULL AND date >= ?`,
        monthStart,
      ).s,
      currency: config.currency,
    });
  });

  router.get('/appointments', (req, res) => {
    const where = [];
    const args = [];
    const add = (clause, ...values) => {
      where.push(clause);
      args.push(...values);
    };
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    const status = String(req.query.status || '');
    const q = String(req.query.q || '').trim();
    if (isValidDate(from)) add('date >= ?', from);
    if (isValidDate(to)) add('date <= ?', to);
    if (status) add('status = ?', status);
    if (q) add('(ref LIKE ? OR phone LIKE ? OR patient_name LIKE ?)', `%${q}%`, `%${q.replace(/^0/, '')}%`, `%${q}%`);
    const rows = db
      .prepare(
        `SELECT * FROM appointments ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date ASC, time ASC LIMIT 500`,
      )
      .all(...args);
    res.json({
      appointments: rows.map((r) => ({ ...publicAppointment(r), phone: r.phone, notes: r.notes, createdAt: r.created_at })),
      doctors: clinic.doctors.map(({ id, name }) => ({ id, name })),
    });
  });

  router.patch('/appointments/:ref', async (req, res) => {
    const appt = getAppointment(db, String(req.params.ref));
    if (!appt) throw new BookingError('الحجز غير موجود', 404);
    const next = String(req.body?.status || '');
    if (!(TRANSITIONS[appt.status] || []).includes(next)) {
      throw new BookingError('لا يمكن تغيير الحالة بهذا الشكل');
    }
    db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), appt.id);
    const updated = getAppointment(db, appt.ref);
    if (next === 'cancelled' && req.body?.notify !== false) {
      await sms.send(updated.phone, cancellationMessage(updated), 'cancellation');
    }
    res.json({ appointment: publicAppointment(updated) });
  });

  router.get('/sms-log', (req, res) => {
    res.json({
      messages: db
        .prepare(`SELECT id, phone, kind, provider, status, error, created_at FROM sms_log ORDER BY id DESC LIMIT 100`)
        .all(),
    });
  });

  return router;
}
