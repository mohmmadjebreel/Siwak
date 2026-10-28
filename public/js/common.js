// Shared helpers for all pages.

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>',
  tooth: '<path d="M7 3c-2.2 0-4 1.8-4 4.5 0 2 .7 3.4 1.3 5 .6 1.7.8 3.5 1.2 5.5.3 1.6.8 3 2 3s1.6-1.5 2-3.2c.3-1.4.8-2.3 2.5-2.3s2.2.9 2.5 2.3c.4 1.7.8 3.2 2 3.2s1.7-1.4 2-3c.4-2 .6-3.8 1.2-5.5.6-1.6 1.3-3 1.3-5C21 4.8 19.2 3 17 3c-1.8 0-2.8 1-5 1S8.8 3 7 3z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  align: '<path d="M3 12h18"/><rect x="5" y="6" width="4" height="12" rx="1.5"/><rect x="15" y="6" width="4" height="12" rx="1.5"/><path d="M10 9h4"/>',
  anchor: '<path d="M9 3h6l-1 5h-4z"/><path d="M10 8l-.5 3h5L14 8M9.5 11 9 14h6l-.5-3M9 14l-.5 3h7L15 14M8.5 17 12 21l3.5-4"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowBack: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.tooth}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const err = new Error(data.error || 'حدث خطأ، حاول مرة أخرى');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const CURRENCY = { JOD: 'دينار', SAR: 'ريال', AED: 'درهم', KWD: 'دينار', ILS: 'شيكل', USD: 'دولار', EGP: 'جنيه', QAR: 'ريال', BHD: 'دينار', OMR: 'ريال' };

export function money(amount, currency) {
  return `${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${CURRENCY[currency] || currency}`;
}

export function dateLabel(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ar-JO-u-nu-latn', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function timeLabel(time) {
  const [h, m] = time.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
}

export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const STATUS = {
  pending_payment: { label: 'بانتظار الدفع', cls: 'pill-warn' },
  confirmed: { label: 'مؤكد', cls: 'pill-ok' },
  completed: { label: 'مكتمل', cls: 'pill-brand' },
  cancelled: { label: 'ملغى', cls: 'pill-muted' },
  no_show: { label: 'لم يحضر', cls: 'pill-danger' },
  expired: { label: 'منتهي الصلاحية', cls: 'pill-muted' },
  payment_conflict: { label: 'دفع بحاجة لمراجعة', cls: 'pill-danger' },
};

export function toast(message, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${esc(label || 'جارٍ التنفيذ…')}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

// Mobile nav + footer year on every page.
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', (e) => {
      if (e.target.closest('a')) links.classList.remove('open');
    });
  }
  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));
  hydrateIcons();
});
