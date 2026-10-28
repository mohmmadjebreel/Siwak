import { api, dateLabel, esc, money, setBusy, timeLabel } from './common.js';

const params = new URLSearchParams(location.search);
const ref = params.get('ref') || '';
const t = params.get('t') || '';
const $ = (id) => document.getElementById(id);

async function complete(outcome, btn) {
  setBusy(btn, true, 'جارٍ المعالجة');
  try {
    const res = await api('/api/payments/mock/complete', { method: 'POST', body: { ref, t, outcome } });
    window.location.href = res.redirectUrl;
  } catch (err) {
    setBusy(btn, false);
    $('err').textContent = err.message;
    $('err').classList.remove('hidden');
  }
}

async function init() {
  try {
    const { appointment: a } = await api(`/api/appointments/${encodeURIComponent(ref)}?t=${encodeURIComponent(t)}`);
    $('details').innerHTML = `
      <div class="ticket-ref"><span class="muted">رقم الحجز</span><b>${esc(a.ref)}</b></div>
      <dl>
        <div><dt>الخدمة</dt><dd>${esc(a.service?.name)}</dd></div>
        <div><dt>الموعد</dt><dd>${esc(dateLabel(a.date))} · ${esc(timeLabel(a.time))}</dd></div>
        <div><dt>المبلغ</dt><dd>${esc(money(a.deposit, a.currency))}</dd></div>
      </dl>`;
    $('pay').disabled = false;
  } catch (err) {
    $('details').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
  $('pay').addEventListener('click', (e) => complete('success', e.currentTarget));
  $('fail').addEventListener('click', (e) => complete('fail', e.currentTarget));
}

init();
