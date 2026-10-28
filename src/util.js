import crypto from 'node:crypto';

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

export function toLatinDigits(value) {
  return String(value ?? '').replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Normalize a phone number to E.164 (+970597736062).
 * Accepts local numbers (0597736062), 00-prefixed, +-prefixed and Arabic-Indic digits.
 */
export function normalizePhone(input, countryCode) {
  let s = toLatinDigits(input).replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) {
    // already international
  } else if (/^97[02]\d{9}$/.test(s) || s.startsWith(countryCode)) {
    s = `+${s}`;
  } else if (s.startsWith('0')) {
    s = `+${countryCode}${s.slice(1)}`;
  } else {
    s = `+${countryCode}${s}`;
  }
  // Palestinian mobiles are often written with Israel's code (+972 59…); Jawwal/Ooredoo live under +970.
  if (/^\+9725[69]\d{7}$/.test(s)) s = `+970${s.slice(4)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Whether a normalized number may book. Empty prefix list = any number. */
export function isAllowedPhone(phone, allowedPrefixes) {
  if (!phone) return false;
  if (!allowedPrefixes.length) return true;
  if (!allowedPrefixes.some((p) => phone.startsWith(p))) return false;
  // Palestinian numbers: +970 followed by exactly 9 digits (0597736062 → +970597736062).
  return !phone.startsWith('+970') || /^\+970\d{9}$/.test(phone);
}

export function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return `${phone.slice(0, 4)}•••••${phone.slice(-3)}`;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRef() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return `SW-${out}`;
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(sha256(a));
  const bb = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(ab, bb);
}

export function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ---- Money ----
const THREE_DECIMAL = new Set(['JOD', 'KWD', 'BHD', 'OMR', 'TND', 'IQD', 'LYD']);

export function currencyDecimals(currency) {
  return THREE_DECIMAL.has(currency) ? 3 : 2;
}

export function toMinorUnits(amount, currency) {
  const minor = Math.round(amount * 10 ** currencyDecimals(currency));
  // Stripe requires three-decimal currencies to be multiples of 10.
  return currencyDecimals(currency) === 3 ? Math.round(minor / 10) * 10 : minor;
}

const CURRENCY_LABELS = { JOD: 'دينار', SAR: 'ريال', AED: 'درهم', KWD: 'دينار', ILS: 'شيكل', USD: 'دولار', EGP: 'جنيه', QAR: 'ريال', BHD: 'دينار', OMR: 'ريال' };

export function formatMoney(amount, currency) {
  const label = CURRENCY_LABELS[currency] || currency;
  return `${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${label}`;
}
