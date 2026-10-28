import express from 'express';
import path from 'node:path';
import { BookingError, getAppointment, markPaid } from '../bookings.js';
import { verifyToken } from '../security.js';

export function paymentRoutes({ db, config, sms, payments, viewToken, publicDir }) {
  const router = express.Router();
  const confirmUrl = (ref) => `/confirm.html?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(viewToken(ref))}`;

  // Patient returns here from the payment page. We never trust the redirect itself:
  // the provider is asked directly whether the payment succeeded.
  router.get('/payment/return', async (req, res) => {
    const appt = getAppointment(db, String(req.query.ref || ''));
    if (!appt) return res.redirect('/');
    try {
      const result = await payments.verifyReturn(req.query, appt);
      if (result.paid) await markPaid(db, config, sms, appt.ref, result.paymentId);
    } catch (err) {
      console.error('[payment] verify failed:', err.message);
    }
    res.redirect(confirmUrl(appt.ref));
  });

  router.get('/payment/cancel', (req, res) => {
    const appt = getAppointment(db, String(req.query.ref || ''));
    res.redirect(appt ? `${confirmUrl(appt.ref)}&cancelled=1` : '/');
  });

  // ---- Stripe webhook (covers patients who close the tab before redirecting back) ----
  router.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (config.payment.provider !== 'stripe' || !payments.parseWebhook) return res.sendStatus(404);
    const event = payments.parseWebhook(req.body, req.get('stripe-signature'));
    if (!event) return res.sendStatus(400);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid' && session.client_reference_id) {
        await markPaid(db, config, sms, session.client_reference_id, session.payment_intent || session.id);
      }
    }
    res.json({ received: true });
  });

  // ---- Tap webhook: body is untrusted, so we re-fetch the charge from Tap before acting ----
  router.post('/api/payments/tap/webhook', express.json({ limit: '100kb' }), async (req, res) => {
    if (config.payment.provider !== 'tap') return res.sendStatus(404);
    const ref = req.body?.reference?.transaction || req.body?.metadata?.ref;
    const appt = ref && getAppointment(db, String(ref));
    if (appt) {
      const result = await payments.verifyReturn({ tap_id: req.body.id }, appt);
      if (result.paid) await markPaid(db, config, sms, appt.ref, result.paymentId);
    }
    res.json({ received: true });
  });

  // ---- Mock checkout (development only) ----
  if (config.payment.provider === 'mock') {
    router.get('/pay/mock', (req, res) => res.sendFile(path.join(publicDir, 'mock-pay.html')));

    router.post('/api/payments/mock/complete', express.json(), async (req, res) => {
      const ref = String(req.body?.ref || '');
      const token = verifyToken(config.sessionSecret, String(req.body?.t || ''));
      const appt = getAppointment(db, ref);
      if (!appt || !token || token.ref !== ref) throw new BookingError('الحجز غير موجود', 404);
      if (req.body?.outcome === 'fail') return res.json({ redirectUrl: `${confirmUrl(ref)}&cancelled=1` });
      await markPaid(db, config, sms, ref, appt.payment_id);
      res.json({ redirectUrl: confirmUrl(ref) });
    });
  }

  return router;
}
