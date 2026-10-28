import { api, dateLabel, esc, money, STATUS, timeLabel, toast } from './common.js';

const $ = (id) => document.getElementById(id);
const state = { range: 'today', today: null };

const ACTIONS = {
  pending_payment: [['cancelled', 'إلغاء', 'btn-ghost']],
  confirmed: [
    ['completed', 'حضر', 'btn-primary'],
    ['no_show', 'لم يحضر', 'btn-ghost'],
    ['cancelled', 'إلغاء', 'btn-ghost'],
  ],
  payment_conflict: [
    ['confirmed', 'تأكيد رغم التعارض', 'btn-primary'],
    ['cancelled', 'إلغاء (استرداد)', 'btn-ghost'],
  ],
  no_show: [['completed', 'حضر', 'btn-ghost']],
};

function showLogin() {
  $('dash-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
  $('password').focus();
}

async function showDashboard() {
  $('login-view').classList.add('hidden');
  $('dash-view').classList.remove('hidden');
  await Promise.all([loadStats(), loadRows()]);
}

async function loadStats() {
  const s = await api('/api/admin/stats');
  state.today = s.today;
  const card = (label, value, alert = false) => `<div class="stat${alert ? ' alert-stat' : ''}"><span>${label}</span><b>${esc(value)}</b></div>`;
  $('stats').innerHTML = [
    card('مواعيد اليوم', s.todayCount),
    card('مواعيد قادمة مؤكدة', s.upcoming),
    card('بانتظار الدفع', s.pending),
    card('دفع بحاجة لمراجعة', s.conflicts, s.conflicts > 0),
    card('عرابين هذا الشهر', money(s.depositsMonth, s.currency)),
  ].join('');
}

async function loadRows() {
  const params = new URLSearchParams();
  if (state.range === 'today' && state.today) {
    params.set('from', state.today);
    params.set('to', state.today);
  } else if (state.range === 'upcoming' && state.today) {
    params.set('from', state.today);
  }
  if ($('f-status').value) params.set('status', $('f-status').value);
  if ($('f-q').value.trim()) params.set('q', $('f-q').value.trim());

  $('rows').innerHTML = '<tr><td colspan="6"><div class="loading"><span class="spinner"></span> جارٍ التحميل…</div></td></tr>';
  const { appointments } = await api(`/api/admin/appointments?${params}`);
  if (!appointments.length) {
    $('rows').innerHTML = '<tr><td colspan="6"><div class="empty">لا توجد مواعيد</div></td></tr>';
    return;
  }
  $('rows').innerHTML = appointments
    .map((a) => {
      const st = STATUS[a.status] || { label: a.status, cls: 'pill-muted' };
      const buttons = (ACTIONS[a.status] || [])
        .map(([to, label, cls]) => `<button class="btn btn-sm ${cls}" data-ref="${esc(a.ref)}" data-to="${to}">${label}</button>`)
        .join('');
      return `<tr>
        <td data-label="الموعد"><b>${esc(timeLabel(a.time))}</b><span class="sub">${esc(dateLabel(a.date))}</span></td>
        <td data-label="المريض">${esc(a.patientName)}<span class="sub"><a href="tel:${esc(a.phone)}" dir="ltr">${esc(a.phone)}</a></span>${a.notes ? `<span class="sub">📝 ${esc(a.notes)}</span>` : ''}</td>
        <td data-label="الخدمة والطبيب">${esc(a.service?.name)}<span class="sub">${esc(a.doctor?.name)} · <bdi dir="ltr">${esc(a.ref)}</bdi></span></td>
        <td data-label="العربون">${esc(money(a.deposit, a.currency))}<span class="sub">${a.paidAt ? 'مدفوع' : 'غير مدفوع'}</span></td>
        <td data-label="الحالة"><span class="pill ${st.cls}">${st.label}</span></td>
        <td data-label="إجراءات" class="actions">${buttons || '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join('');
}

async function changeStatus(btn) {
  const { ref, to } = btn.dataset;
  if (to === 'cancelled' && !confirm(`إلغاء الحجز ${ref}؟ سيتم إرسال رسالة للمريض.`)) return;
  btn.disabled = true;
  try {
    await api(`/api/admin/appointments/${encodeURIComponent(ref)}`, { method: 'PATCH', body: { status: to } });
    toast('تم تحديث الحالة');
    await Promise.all([loadStats(), loadRows()]);
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

function bind() {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-err').classList.add('hidden');
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
      $('password').value = '';
      await showDashboard();
    } catch (err) {
      $('login-err').textContent = err.message;
      $('login-err').classList.remove('hidden');
    }
  });
  $('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} });
    showLogin();
  });
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    document.querySelectorAll('#tabs .chip').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    loadRows();
  });
  $('f-status').addEventListener('change', loadRows);
  let debounce;
  $('f-q').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(loadRows, 300);
  });
  $('refresh').addEventListener('click', () => Promise.all([loadStats(), loadRows()]));
  $('rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-to]');
    if (btn) changeStatus(btn);
  });
}

async function init() {
  bind();
  const { loggedIn } = await api('/api/admin/me');
  if (loggedIn) await showDashboard();
  else showLogin();
}

init().catch((err) => toast(err.message));
