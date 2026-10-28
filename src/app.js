import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookingError, setPaymentId } from './bookings.js';
import { getService } from './clinic.js';
import { createPayments } from './payments/index.js';
import { adminRoutes } from './routes/admin.js';
import { paymentRoutes } from './routes/payments.js';
import { publicRoutes } from './routes/public.js';
import { createRateLimiter, securityHeaders, signToken } from './security.js';
import { createSms } from './sms/index.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ db, config }) {
  const sms = createSms(config, db);
  const payments = createPayments(config);
  const allow = createRateLimiter();

  const viewToken = (ref) => signToken(config.sessionSecret, { ref });

  async function startCheckout(appt) {
    const ref = encodeURIComponent(appt.ref);
    const service = getService(appt.service_id);
    const { redirectUrl, paymentId } = await payments.createCheckout(appt, {
      returnUrl: `${config.baseUrl}/payment/return?ref=${ref}`,
      cancelUrl: `${config.baseUrl}/payment/cancel?ref=${ref}`,
      webhookUrl: `${config.baseUrl}/api/payments/tap/webhook`,
      mockUrl: `/pay/mock?ref=${ref}&t=${encodeURIComponent(viewToken(appt.ref))}`,
      description: `عربون حجز ${service?.name || ''} — ${appt.ref}`,
    });
    if (!redirectUrl) throw new BookingError('تعذّر فتح صفحة الدفع، حاول مجدداً', 502);
    setPaymentId(db, appt.ref, paymentId);
    return redirectUrl;
  }

  const app = express();
  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);
  app.use(securityHeaders);

  // Payment routes first: the Stripe webhook needs the raw body.
  app.use(paymentRoutes({ db, config, sms, payments, viewToken, publicDir }));

  app.use(express.json({ limit: '20kb' }));
  app.use('/api', publicRoutes({ db, config, sms, allow, startCheckout, viewToken }));
  app.use('/api/admin', adminRoutes({ db, config, sms, allow }));
  app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
  app.get('/book', (req, res) => res.sendFile(path.join(publicDir, 'book.html')));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: config.isProduction ? '1h' : 0 }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'طلب غير صالح' });
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع، حاول مرة أخرى' });
  });

  return { app, sms, payments };
}
