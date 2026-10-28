import crypto from 'node:crypto';
import path from 'node:path';

// Load .env if present (Node >= 21.7). Real environment variables win.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const port = Number(env.PORT || 3000);

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(overrides = {}) {
  const config = {
    isProduction,
    port,
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dbPath: env.DB_PATH || path.resolve('data/siwak.db'),
    timezone: env.CLINIC_TIMEZONE || 'Asia/Hebron',
    defaultCountryCode: (env.DEFAULT_COUNTRY_CODE || '970').replace(/\D/g, ''),
    // Only these mobile prefixes may book (default: Palestinian Jawwal 059 and Ooredoo 056).
    allowedPhonePrefixes: (env.ALLOWED_PHONE_PREFIXES ?? '+97059,+97056')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    currency: (env.CURRENCY || 'ILS').toUpperCase(),
    holdMinutes: Number(env.HOLD_MINUTES || 30),
    sessionSecret: env.SESSION_SECRET || (isProduction ? required('SESSION_SECRET') : crypto.randomBytes(32).toString('hex')),
    adminPassword: env.ADMIN_PASSWORD || (isProduction ? required('ADMIN_PASSWORD') : 'admin'),
    sms: {
      provider: env.SMS_PROVIDER || 'console',
      twilio: {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        from: env.TWILIO_FROM,
        messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
      },
    },
    payment: {
      provider: env.PAYMENT_PROVIDER || 'mock',
      stripe: {
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      },
      tap: {
        secretKey: env.TAP_SECRET_KEY,
      },
    },
    ...overrides,
  };

  if (config.isProduction) {
    if (config.payment.provider === 'mock') {
      throw new Error('PAYMENT_PROVIDER=mock is not allowed in production. Use stripe or tap.');
    }
    if (config.sms.provider === 'console') {
      console.warn('[siwak] WARNING: SMS_PROVIDER=console in production — patients will not receive SMS.');
    }
  } else if (!env.ADMIN_PASSWORD) {
    console.warn('[siwak] ADMIN_PASSWORD not set — using "admin" for local development.');
  }

  return config;
}
