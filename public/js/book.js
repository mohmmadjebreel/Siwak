import { api, dateLabel, esc, icon, money, setBusy, timeLabel, toast, weekdayOf } from './common.js';

const $ = (id) => document.getElementById(id);

const state = {
  clinic: null,
  step: 1,
  serviceId: null,
  doctorId: 'any',
  date: null,
  time: null,
  verifyToken: null,
  verifiedPhone: null,
  resendTimer: null,
};

const service = () => state.clinic.services.find((s) => s.id === state.serviceId);
const doctor = () => state.clinic.doctors.find((d) => d.id === state.doctorId);

function showError(step, message) {
  const el = $(`err-${step}`);
  if (!el) return toast(message);
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function goTo(step) {
  state.step = step;
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', Number(p.dataset.panel) !== step));
  document.querySelectorAll('#stepper li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSummary() {
  const s = service();
  const d = doctor();
  $('s-service').textContent = s ? s.name : '—';
  $('s-doctor').textContent = s ? (d ? d.name : 'أول طبيب متاح') : '—';
  $('s-date').textContent = state.date ? dateLabel(state.date) : '—';
  $('s-time').textContent = state.time ? timeLabel(state.time) : '—';
  $('s-duration').textContent = s ? `${s.durationMin} دقيقة` : '—';
  $('s-deposit').textContent = s ? money(s.deposit, state.clinic.currency) : '—';
}

// ---------- Step 1 ----------
function renderServices() {
  $('service-list').innerHTML = state.clinic.services
    .map(
      (s) => `
      <button type="button" class="choice" data-service="${esc(s.id)}" aria-pressed="${s.id === state.serviceId}">
        <span class="ic">${icon(s.icon)}</span>
        <span>
          <b>${esc(s.name)}</b>
          <small>${esc(s.description)}</small>
          <span class="price">عربون ${esc(money(s.deposit, state.clinic.currency))} · ${s.durationMin} دقيقة</span>
        </span>
      </button>`,
    )
    .join('');
}

function selectService(id) {
  if (state.serviceId !== id) {
    state.serviceId = id;
    state.doctorId = 'any';
    state.date = null;
    state.time = null;
  }
  renderServices();
  renderDoctors();
  renderDates();
  renderSlots();
  renderSummary();
  goTo(2);
}

// ---------- Step 2 ----------
function doctorsForService() {
  return state.clinic.doctors.filter((d) => d.services.includes(state.serviceId));
}

function renderDoctors() {
  const chips = [{ id: 'any', name: 'أي طبيب متاح', title: 'أقرب موعد' }, ...doctorsForService()];
  $('doctor-list').innerHTML = chips
    .map(
      (d) => `<button type="button" class="chip" data-doctor="${esc(d.id)}" aria-pressed="${d.id === state.doctorId}">
        ${esc(d.name)}<small>${esc(d.title)}</small></button>`,
    )
    .join('');
}

function dateIsOpen(entry) {
  if (!entry.open) return false;
  const day = weekdayOf(entry.date);
  const docs = state.doctorId === 'any' ? doctorsForService() : [doctor()];
  return docs.some((d) => d && d.days.includes(day));
}

function renderDates() {
  const fmt = (date, opts) => new Intl.DateTimeFormat('ar-JO-u-nu-latn', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  $('date-list').innerHTML = state.clinic.dates
    .map((entry, i) => {
      const open = dateIsOpen(entry);
      const label = i === 0 ? 'اليوم' : i === 1 ? 'غداً' : fmt(entry.date, { weekday: 'short' });
      return `<button type="button" class="date-btn" data-date="${entry.date}" ${open ? '' : 'disabled'}
        aria-pressed="${entry.date === state.date}" aria-label="${esc(dateLabel(entry.date))}">
        <span>${esc(label)}</span><b>${fmt(entry.date, { day: 'numeric' })}</b><span>${esc(fmt(entry.date, { month: 'short' }))}</span>
      </button>`;
    })
    .join('');
}

let slotsRequest = 0;
async function renderSlots() {
  const area = $('slot-area');
  $('to-3').disabled = !state.time;
  if (!state.date) {
    area.innerHTML = '<div class="empty">اختر اليوم لعرض الأوقات المتاحة</div>';
    return;
  }
  const req = ++slotsRequest;
  area.innerHTML = '<div class="loading"><span class="spinner"></span> جارٍ البحث عن الأوقات المتاحة…</div>';
  try {
    const params = new URLSearchParams({ serviceId: state.serviceId, doctorId: state.doctorId, date: state.date });
    const { slots } = await api(`/api/slots?${params}`);
    if (req !== slotsRequest) return;
    if (state.time && !slots.includes(state.time)) state.time = null;
    if (!slots.length) {
      area.innerHTML = '<div class="empty">لا توجد أوقات متاحة في هذا اليوم. جرّب يوماً آخر أو طبيباً آخر.</div>';
    } else {
      const morning = slots.filter((t) => Number(t.slice(0, 2)) < 12);
      const evening = slots.filter((t) => Number(t.slice(0, 2)) >= 12);
      const group = (title, list) =>
        list.length
          ? `<div class="slot-group"><h4>${title}</h4><div class="slots">${list
              .map((t) => `<button type="button" class="slot" data-time="${t}" aria-pressed="${t === state.time}">${timeLabel(t)}</button>`)
              .join('')}</div></div>`
          : '';
      area.innerHTML = group('الفترة الصباحية', morning) + group('الفترة المسائية', evening);
    }
  } catch (err) {
    if (req === slotsRequest) area.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
  $('to-3').disabled = !state.time;
  renderSummary();
}

// ---------- Step 3 ----------
function updateSubmit() {
  const ready = state.verifyToken && $('name').value.trim().length >= 2 && $('agree').checked;
  $('submit').disabled = !ready;
}

function startResendCountdown(seconds) {
  const btn = $('send-otp');
  clearInterval(state.resendTimer);
  let left = seconds;
  btn.disabled = true;
  btn.textContent = `إعادة الإرسال (${left})`;
  state.resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(state.resendTimer);
      btn.disabled = false;
      btn.textContent = 'إعادة إرسال الرمز';
    } else {
      btn.textContent = `إعادة الإرسال (${left})`;
    }
  }, 1000);
}

async function sendOtp() {
  showError(3, '');
  const btn = $('send-otp');
  const phone = $('phone').value.trim();
  if (!phone) return showError(3, 'اكتب رقم جوالك أولاً');
  setBusy(btn, true, 'جارٍ الإرسال');
  try {
    const res = await api('/api/otp/send', { method: 'POST', body: { phone } });
    setBusy(btn, false);
    $('otp-field').classList.remove('hidden');
    $('otp-hint').textContent = `أرسلنا الرمز إلى ${res.phone}. الرمز صالح لمدة 10 دقائق.`;
    $('otp').value = '';
    $('otp').focus();
    startResendCountdown(res.resendAfter || 60);
  } catch (err) {
    setBusy(btn, false);
    if (err.data?.retryAfter) startResendCountdown(err.data.retryAfter);
    showError(3, err.message);
  }
}

async function verifyOtp() {
  showError(3, '');
  const btn = $('verify-otp');
  const code = $('otp').value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
  if (code.length !== 6) return showError(3, 'الرمز مكوّن من 6 أرقام');
  setBusy(btn, true, 'جارٍ التحقق');
  try {
    const res = await api('/api/otp/verify', { method: 'POST', body: { phone: $('phone').value.trim(), code } });
    state.verifyToken = res.verifyToken;
    state.verifiedPhone = $('phone').value.trim();
    $('verified-phone').textContent = state.verifiedPhone;
    $('otp-field').classList.add('hidden');
    $('verified-field').classList.remove('hidden');
    $('send-otp').classList.add('hidden');
    clearInterval(state.resendTimer);
  } catch (err) {
    showError(3, err.message);
  } finally {
    setBusy(btn, false);
    updateSubmit();
  }
}

function resetVerification() {
  if (!state.verifyToken) return;
  state.verifyToken = null;
  state.verifiedPhone = null;
  $('verified-field').classList.add('hidden');
  $('send-otp').classList.remove('hidden');
  $('send-otp').disabled = false;
  $('send-otp').textContent = 'أرسل رمز التحقق';
  updateSubmit();
}

async function submit() {
  showError(3, '');
  const btn = $('submit');
  setBusy(btn, true, 'جارٍ تثبيت الموعد');
  try {
    const res = await api('/api/appointments', {
      method: 'POST',
      body: {
        serviceId: state.serviceId,
        doctorId: state.doctorId,
        date: state.date,
        time: state.time,
        name: $('name').value.trim(),
        notes: $('notes').value.trim(),
        agree: $('agree').checked,
        verifyToken: state.verifyToken,
      },
    });
    goTo(4);
    window.location.href = res.redirectUrl;
  } catch (err) {
    setBusy(btn, false);
    if (err.status === 409) {
      state.time = null;
      goTo(2);
      renderSlots();
      showError(2, err.message);
    } else if (err.status === 401) {
      resetVerification();
      showError(3, err.message);
    } else {
      showError(3, err.message);
    }
  }
}

// ---------- Wiring ----------
function bind() {
  $('service-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-service]');
    if (btn) selectService(btn.dataset.service);
  });
  $('doctor-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-doctor]');
    if (!btn) return;
    state.doctorId = btn.dataset.doctor;
    const current = state.clinic.dates.find((d) => d.date === state.date);
    if (current && !dateIsOpen(current)) state.date = null;
    renderDoctors();
    renderDates();
    renderSlots();
    renderSummary();
  });
  $('date-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn || btn.disabled) return;
    state.date = btn.dataset.date;
    state.time = null;
    renderDates();
    renderSlots();
    renderSummary();
  });
  $('slot-area').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-time]');
    if (!btn) return;
    state.time = btn.dataset.time;
    document.querySelectorAll('#slot-area .slot').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    $('to-3').disabled = false;
    showError(2, '');
    renderSummary();
  });
  $('to-3').addEventListener('click', () => {
    goTo(3);
    $('name').focus();
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => goTo(Number(b.dataset.back))));

  $('send-otp').addEventListener('click', sendOtp);
  $('verify-otp').addEventListener('click', verifyOtp);
  $('otp').addEventListener('input', () => {
    if ($('otp').value.replace(/\D/g, '').length === 6) verifyOtp();
  });
  $('otp').addEventListener('keydown', (e) => e.key === 'Enter' && verifyOtp());
  $('phone').addEventListener('keydown', (e) => e.key === 'Enter' && sendOtp());
  $('phone').addEventListener('input', () => {
    if (state.verifiedPhone && $('phone').value.trim() !== state.verifiedPhone) resetVerification();
  });
  $('name').addEventListener('input', updateSubmit);
  $('agree').addEventListener('change', updateSubmit);
  $('submit').addEventListener('click', submit);
}

async function init() {
  bind();
  try {
    state.clinic = await api('/api/clinic');
  } catch (err) {
    $('service-list').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  $('s-hold').textContent = state.clinic.holdMinutes;
  document.querySelectorAll('[data-cancel-hours]').forEach((el) => (el.textContent = state.clinic.cancelHours));
  renderServices();
  renderSummary();
  goTo(1);

  const pre = new URLSearchParams(location.search).get('service');
  if (pre && state.clinic.services.some((s) => s.id === pre)) selectService(pre);
}

init();
