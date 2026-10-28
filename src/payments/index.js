import crypto from 'node:crypto';
import { currencyDecimals, toMinorUnits } from '../util.js';

/*
 * Payment providers share one interface:
 *   createCheckout(appt, { returnUrl, cancelUrl, description }) -> { redirectUrl, paymentId }
 *   verifyReturn(query, appt) -> { paid: boolean, paymentId }
 *
 * - mock:   local demo checkout page, no money moves (development only)
 * - stripe: Stripe Checkout (cards, Apple Pay, Google Pay)
 * - tap:    Tap Payments (Jordan & GCC: cards, mada, KNET, Apple Pay ...)
 */

function mockProvider() {
  return {
    name: 'mock',
    async createCheckout(appt, { mockUrl }) {
      return { redirectUrl: mockUrl, paymentId: `mock_${crypto.randomBytes(8).toString('hex')}` };
    },
    async verifyReturn() {
      // Mock payments are completed through POST /api/payments/mock/complete instead.
      return { paid: false };
    },
  };
}

function stripeProvider({ secretKey, webhookSecret }) {
  if (!secretKey) throw new Error('Stripe requires STRIPE_SECRET_KEY.');
  const api = async (method, path, form) => {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${json.error?.message || 'error'}`);
    return json;
  };

  return {
    name: 'stripe',
    async createCheckout(appt, { returnUrl, cancelUrl, description }) {
      const session = await api('POST', '/checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': appt.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(toMinorUnits(appt.deposit_amount, appt.currency)),
        'line_items[0][price_data][product_data][name]': description,
        client_reference_id: appt.ref,
        'metadata[ref]': appt.ref,
        'payment_intent_data[metadata][ref]': appt.ref,
        success_url: `${returnUrl}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        locale: 'auto',
        // Stripe's minimum session lifetime is 30 minutes.
        expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
      });
      return { redirectUrl: session.url, paymentId: session.id };
    },
    async verifyReturn(query, appt) {
      const id = String(query.session_id || appt.payment_id || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return { paid: false };
      const session = await api('GET', `/checkout/sessions/${id}`);
      const paid = session.payment_status === 'paid' && session.client_reference_id === appt.ref;
      return { paid, paymentId: session.payment_intent || session.id };
    },
    /** Verifies the Stripe-Signature header. Returns the parsed event or null. */
    parseWebhook(rawBody, signatureHeader) {
      if (!webhookSecret || !signatureHeader) return null;
      const parts = Object.fromEntries(
        String(signatureHeader)
          .split(',')
          .map((kv) => kv.split('=')),
      );
      const timestamp = Number(parts.t);
      if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return null;
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${parts.t}.${rawBody.toString('utf8')}`)
        .digest('hex');
      const signatures = String(signatureHeader)
        .split(',')
        .filter((kv) => kv.startsWith('v1='))
        .map((kv) => kv.slice(3));
      const ok = signatures.some(
        (sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)),
      );
      return ok ? JSON.parse(rawBody.toString('utf8')) : null;
    },
  };
}

function tapProvider({ secretKey }, { defaultCountryCode }) {
  if (!secretKey) throw new Error('Tap requires TAP_SECRET_KEY.');
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.tap.company/v2${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Tap ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
    return json;
  };

  const splitPhone = (e164) => {
    const digits = e164.replace(/^\+/, '');
    return digits.startsWith(defaultCountryCode)
      ? { country_code: defaultCountryCode, number: digits.slice(defaultCountryCode.length) }
      : { country_code: digits.slice(0, 3), number: digits.slice(3) };
  };

  return {
    name: 'tap',
    async createCheckout(appt, { returnUrl, webhookUrl, description }) {
      const charge = await api('POST', '/charges', {
        amount: Number(appt.deposit_amount.toFixed(currencyDecimals(appt.currency))),
        currency: appt.currency,
        threeDSecure: true,
        save_card: false,
        description,
        reference: { transaction: appt.ref, order: appt.ref },
        metadata: { ref: appt.ref },
        customer: { first_name: appt.patient_name, phone: splitPhone(appt.phone) },
        source: { id: 'src_all' },
        post: { url: webhookUrl },
        redirect: { url: returnUrl },
      });
      return { redirectUrl: charge.transaction?.url, paymentId: charge.id };
    },
    async verifyReturn(query, appt) {
      const id = String(query.tap_id || appt.payment_id || '');
      if (!/^chg_[A-Za-z0-9_]+$/.test(id)) return { paid: false };
      const charge = await api('GET', `/charges/${id}`);
      const refMatches = charge.reference?.transaction === appt.ref || charge.metadata?.ref === appt.ref;
      const amountMatches =
        Math.abs(Number(charge.amount) - appt.deposit_amount) < 0.001 && charge.currency === appt.currency;
      return { paid: charge.status === 'CAPTURED' && refMatches && amountMatches, paymentId: charge.id };
    },
  };
}

export function createPayments(config) {
  switch (config.payment.provider) {
    case 'stripe':
      return stripeProvider(config.payment.stripe);
    case 'tap':
      return tapProvider(config.payment.tap, config);
    case 'mock':
      return mockProvider();
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${config.payment.provider}`);
  }
}
