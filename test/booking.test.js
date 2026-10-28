import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createPayments } from '../src/payments/index.js';
import { expireHolds, sendReminders } from '../src/scheduler.js';
import { addDays, minutesUntil, nowInZone } from '../src/time.js';
import { normalizePhone, toMinorUnits } from '../src/util.js';

const config = {
  isProduction: false,
  port: 0,
  baseUrl: 'http://localhost',
  timezone: 'Asia/Amman',
  defaultCountryCode: '962',
  currency: 'JOD',
  holdMinutes: 30,
  sessionSecret: 'test-secret',
  adminPassword: 'pa55word',
  sms: { provider: 'console' },
  payment: { provider: 'mock', stripe: {}, tap: {} },
};

let db;
let server;
let base;
const originalLog = console.log;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, json, headers: res.headers };
}

function lastSms(phone, kind) {
  return db.prepare('SELECT * FROM sms_log WHERE phone = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(phone, kind);
}

async function verifiedToken(localPhone) {
  const phone = normalizePhone(localPhone, '962');
  const sent = await call('/api/otp/send', { method: 'POST', body: { phone: localPhone } });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const code = lastSms(phone, 'otp').body.match(/\d{6}/)[0];
  const verified = await call('/api/otp/verify', { method: 'POST', body: { phone: localPhone, code } });
  assert.equal(verified.status, 200);
  return verified.json.verifyToken;
}

/** First date (from tomorrow on) with slots for the service/doctor. */
async function findSlot(serviceId, doctorId) {
  const today = nowInZone(config.timezone).date;
  for (let i = 1; i <= 14; i++) {
    const date = addDays(today, i);
    const { json } = await call(`/api/slots?serviceId=${serviceId}&doctorId=${doctorId}&date=${date}`);
    if (json.slots.length) return { date, time: json.slots[0] };
  }
  throw new Error('no slot found');
}

before(async () => {
  console.log = () => {}; // silence console SMS output
  db = openDb(':memory:');
  const { app } = createApp({ db, config });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  console.log = originalLog;
  server.close();
});

describe('helpers', () => {
  test('normalizePhone handles local, international and Arabic digits', () => {
    assert.equal(normalizePhone('0791234567', '962'), '+962791234567');
    assert.equal(normalizePhone('+962 79 123 4567', '962'), '+962791234567');
    assert.equal(normalizePhone('00962791234567', '962'), '+962791234567');
    assert.equal(normalizePhone('٠٧٩١٢٣٤٥٦٧', '962'), '+962791234567');
    assert.equal(normalizePhone('12', '962'), null);
    assert.equal(normalizePhone('abc', '962'), null);
  });

  test('three-decimal currencies are rounded to multiples of 10 minor units', () => {
    assert.equal(toMinorUnits(10, 'JOD'), 10000);
    assert.equal(toMinorUnits(5.555, 'JOD'), 5560);
    assert.equal(toMinorUnits(10, 'USD'), 1000);
  });

  test('minutesUntil counts across days', () => {
    const at = new Date('2026-03-10T10:00:00Z'); // 13:00 in Amman (UTC+3)
    assert.equal(minutesUntil('2026-03-10', '14:00', 'Asia/Amman', at), 60);
    assert.equal(minutesUntil('2026-03-11', '13:00', 'Asia/Amman', at), 1440);
  });

  test('stripe webhook signature is verified', () => {
    const stripe = createPayments({ ...config, payment: { provider: 'stripe', stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_x' } } });
    const body = Buffer.from(JSON.stringify({ type: 'checkout.session.completed' }));
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
    assert.ok(stripe.parseWebhook(body, `t=${t},v1=${sig}`));
    assert.equal(stripe.parseWebhook(body, `t=${t},v1=${'0'.repeat(64)}`), null);
    assert.equal(stripe.parseWebhook(body, `t=${t - 1000},v1=${sig}`), null);
  });
});

describe('booking flow', () => {
  test('clinic info lists services and bookable dates', async () => {
    const { status, json } = await call('/api/clinic');
    assert.equal(status, 200);
    assert.ok(json.services.length > 0);
    assert.ok(json.dates.some((d) => d.open));
  });

  test('booking requires a verified phone', async () => {
    const slot = await findSlot('cleaning', 'dr-1');
    const res = await call('/api/appointments', {
      method: 'POST',
      body: { serviceId: 'cleaning', doctorId: 'dr-1', ...slot, name: 'Test', agree: true, verifyToken: 'forged.token' },
    });
    assert.equal(res.status, 401);
  });

  test('wrong OTP is rejected and attempts are limited', async () => {
    await call('/api/otp/send', { method: 'POST', body: { phone: '0780000001' } });
    for (let i = 0; i < 5; i++) {
      const r = await call('/api/otp/verify', { method: 'POST', body: { phone: '0780000001', code: '000000' } });
      assert.ok([400].includes(r.status));
    }
    const code = lastSms('+962780000001', 'otp').body.match(/\d{6}/)[0];
    const locked = await call('/api/otp/verify', { method: 'POST', body: { phone: '0780000001', code } });
    assert.equal(locked.status, 429);
  });

  test('OTP resend is throttled', async () => {
    await call('/api/otp/send', { method: 'POST', body: { phone: '0780000002' } });
    const again = await call('/api/otp/send', { method: 'POST', body: { phone: '0780000002' } });
    assert.equal(again.status, 429);
    assert.ok(again.json.retryAfter > 0);
  });

  test('full flow: hold slot → pay deposit → confirmed + SMS', async () => {
    const token = await verifiedToken('0791234567');
    const slot = await findSlot('filling', 'dr-1');

    const created = await call('/api/appointments', {
      method: 'POST',
      body: { serviceId: 'filling', doctorId: 'dr-1', ...slot, name: 'محمد أحمد', notes: 'ألم', agree: true, verifyToken: token },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const { ref, t, redirectUrl } = created.json;
    assert.match(ref, /^SW-[A-Z0-9]{6}$/);
    assert.match(redirectUrl, /^\/pay\/mock\?ref=/);
    assert.equal(created.json.appointment.status, 'pending_payment');
    assert.equal(created.json.appointment.deposit, 10);

    // The held slot disappears for that doctor.
    const after = await call(`/api/slots?serviceId=filling&doctorId=dr-1&date=${slot.date}`);
    assert.ok(!after.json.slots.includes(slot.time));

    // Viewing requires the signed token.
    assert.equal((await call(`/api/appointments/${ref}?t=bad`)).status, 404);
    const view = await call(`/api/appointments/${ref}?t=${encodeURIComponent(t)}`);
    assert.equal(view.json.appointment.status, 'pending_payment');

    const paid = await call('/api/payments/mock/complete', { method: 'POST', body: { ref, t } });
    assert.equal(paid.status, 200);
    const confirmed = await call(`/api/appointments/${ref}?t=${encodeURIComponent(t)}`);
    assert.equal(confirmed.json.appointment.status, 'confirmed');
    assert.ok(confirmed.json.appointment.paidAt);

    const sms = lastSms('+962791234567', 'confirmation');
    assert.ok(sms, 'confirmation SMS sent');
    assert.ok(sms.body.includes(ref));

    // Paying twice does not send a second confirmation.
    await call('/api/payments/mock/complete', { method: 'POST', body: { ref, t } });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM sms_log WHERE kind = 'confirmation' AND body LIKE ?`).get(`%${ref}%`).n;
    assert.equal(count, 1);
  });

  test('the same doctor cannot be double-booked', async () => {
    const slot = await findSlot('checkup', 'dr-3');
    const first = await call('/api/appointments', {
      method: 'POST',
      body: { serviceId: 'checkup', doctorId: 'dr-3', ...slot, name: 'Ali', agree: true, verifyToken: await verifiedToken('0771111111') },
    });
    assert.equal(first.status, 201);
    const second = await call('/api/appointments', {
      method: 'POST',
      body: { serviceId: 'checkup', doctorId: 'dr-3', ...slot, name: 'Badr', agree: true, verifyToken: await verifiedToken('0772222222') },
    });
    assert.equal(second.status, 409);
  });

  test('expired holds release the slot', async () => {
    const slot = await findSlot('orthodontics', 'dr-2');
    const created = await call('/api/appointments', {
      method: 'POST',
      body: { serviceId: 'orthodontics', doctorId: 'dr-2', ...slot, name: 'Carla', agree: true, verifyToken: await verifiedToken('0773333333') },
    });
    assert.equal(created.status, 201);
    db.prepare('UPDATE appointments SET hold_expires_at = ? WHERE ref = ?').run(Date.now() - 1000, created.json.ref);
    assert.ok(expireHolds(db) >= 1);
    const slots = await call(`/api/slots?serviceId=orthodontics&doctorId=dr-2&date=${slot.date}`);
    assert.ok(slots.json.slots.includes(slot.time));

    // Retrying payment re-holds the slot while it's still free.
    const retry = await call(`/api/appointments/${created.json.ref}/pay`, { method: 'POST', body: { t: created.json.t } });
    assert.equal(retry.status, 200);
    const view = await call(`/api/appointments/${created.json.ref}?t=${encodeURIComponent(created.json.t)}`);
    assert.equal(view.json.appointment.status, 'pending_payment');
  });
});

describe('reminders', () => {
  test('a reminder is sent once for appointments within 24h', async () => {
    const now = nowInZone(config.timezone);
    // Build an appointment ~20h from now in clinic-local time.
    const target = now.minutes + 20 * 60;
    const date = addDays(now.date, Math.floor(target / 1440));
    const mins = target % 1440;
    const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const ts = Date.now() - 2 * 86_400_000;
    db.prepare(
      `INSERT INTO appointments (ref, patient_name, phone, service_id, doctor_id, date, time, duration_min, status,
        deposit_amount, currency, paid_at, created_at, updated_at)
       VALUES ('SW-REMIND', 'R', '+962790000009', 'checkup', 'dr-1', ?, ?, 30, 'confirmed', 5, 'JOD', ?, ?, ?)`,
    ).run(date, time, ts, ts, ts);

    const sms = { sent: [], async send(to, body) { this.sent.push({ to, body }); return true; } };
    await sendReminders(db, config, sms);
    await sendReminders(db, config, sms);
    assert.equal(sms.sent.filter((m) => m.to === '+962790000009').length, 1);
  });
});

describe('admin', () => {
  test('login, list, cancel with SMS', async () => {
    assert.equal((await call('/api/admin/stats')).status, 401);
    assert.equal((await call('/api/admin/login', { method: 'POST', body: { password: 'nope' } })).status, 401);

    const login = await call('/api/admin/login', { method: 'POST', body: { password: 'pa55word' } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);

    const stats = await call('/api/admin/stats', { cookie });
    assert.equal(stats.status, 200);

    const list = await call('/api/admin/appointments?status=confirmed', { cookie });
    const target = list.json.appointments.find((a) => a.phone === '+962791234567');
    assert.ok(target);

    // Invalid transition.
    const bad = await call(`/api/admin/appointments/${target.ref}`, { method: 'PATCH', body: { status: 'expired' }, cookie });
    assert.equal(bad.status, 400);

    const cancelled = await call(`/api/admin/appointments/${target.ref}`, { method: 'PATCH', body: { status: 'cancelled' }, cookie });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.appointment.status, 'cancelled');
    assert.ok(lastSms('+962791234567', 'cancellation'));
  });
});
