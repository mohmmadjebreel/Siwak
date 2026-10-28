import { api, dateLabel, esc, icon, money, setBusy, timeLabel } from './common.js';

const params = new URLSearchParams(location.search);
const ref = params.get('ref') || '';
const t = params.get('t') || '';
const userCancelled = params.get('cancelled') === '1';
const root = document.getElementById('result');

let polls = 0;

function ticket(a) {
  return `
  <div class="panel ticket">
    <div class="ticket-ref"><span class="muted">رقم الحجز</span><b>${esc(a.ref)}</b></div>
    <dl>
      <div><dt>الاسم</dt><dd>${esc(a.patientName)}</dd></div>
      <div><dt>الخدمة</dt><dd>${esc(a.service?.name)}</dd></div>
      <div><dt>الطبيب</dt><dd>${esc(a.doctor?.name)}</dd></div>
      <div><dt>التاريخ</dt><dd>${esc(dateLabel(a.date))}</dd></div>
      <div><dt>الوقت</dt><dd>${esc(timeLabel(a.time))}</dd></div>
      <div><dt>العربون</dt><dd>${esc(money(a.deposit, a.currency))} ${a.paidAt ? '<span class="pill pill-ok">مدفوع</span>' : '<span class="pill pill-warn">غير مدفوع</span>'}</dd></div>
    </dl>
  </div>`;
}

function icsFile(a) {
  const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const [h, m] = a.time.split(':').map(Number);
  const endMin = h * 60 + m + a.durationMin;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Siwak//Booking//AR',
    'BEGIN:VEVENT',
    `UID:${a.ref}@siwak`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${stamp(a.date, a.time)}`,
    `DTEND:${stamp(a.date, end)}`,
    `SUMMARY:موعد أسنان — ${a.service?.name} (سواك)`,
    `DESCRIPTION:رقم الحجز ${a.ref} مع ${a.doctor?.name}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:موعدك في عيادة سواك',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function view({ tone, iconName, title, text, appointment, actions = '' }) {
  root.innerHTML = `
    <div class="result-icon ${tone}">${icon(iconName)}</div>
    <h1>${title}</h1>
    <p class="muted">${text}</p>
    ${appointment ? ticket(appointment) : ''}
    <div class="result-actions">${actions}</div>`;
}

async function retryPayment(btn) {
  setBusy(btn, true, 'جارٍ فتح صفحة الدفع');
  try {
    const res = await api(`/api/appointments/${encodeURIComponent(ref)}/pay`, { method: 'POST', body: { t } });
    window.location.href = res.redirectUrl;
  } catch (err) {
    setBusy(btn, false);
    root.insertAdjacentHTML('afterbegin', `<div class="alert alert-error" role="alert">${esc(err.message)}</div>`);
  }
}

async function load() {
  let data;
  try {
    data = await api(`/api/appointments/${encodeURIComponent(ref)}?t=${encodeURIComponent(t)}`);
  } catch (err) {
    view({
      tone: 'danger',
      iconName: 'alert',
      title: 'لم نعثر على الحجز',
      text: esc(err.message),
      actions: '<a class="btn btn-primary" href="/book">احجز موعداً</a>',
    });
    return;
  }

  const a = data.appointment;
  const phone = esc(data.clinicPhone);
  const payBtn = `<button class="btn btn-primary" id="retry">${icon('card')} إتمام دفع العربون</button>`;

  switch (a.status) {
    case 'confirmed':
      view({
        tone: 'ok',
        iconName: 'checkCircle',
        title: 'تم تأكيد موعدك 🎉',
        text: 'استلمنا العربون وأرسلنا رسالة تأكيد إلى جوالك تتضمن رقم الحجز. سنذكّرك قبل الموعد بيوم.',
        appointment: a,
        actions: `<button class="btn btn-primary" id="ics">${icon('download')} أضف إلى التقويم</button>
                  <a class="btn btn-ghost" href="/">العودة للرئيسية</a>`,
      });
      document.getElementById('ics').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([icsFile(a)], { type: 'text/calendar;charset=utf-8' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: `siwak-${a.ref}.ics` });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      break;

    case 'pending_payment': {
      // The provider may still be notifying us; poll briefly before asking the patient to retry.
      if (!userCancelled && polls < 5) {
        polls += 1;
        root.innerHTML = '<div class="loading"><span class="spinner"></span> جارٍ تأكيد الدفع…</div>';
        setTimeout(load, 2500);
        return;
      }
      const minutes = Math.max(0, Math.round((a.holdExpiresAt - Date.now()) / 60000));
      view({
        tone: 'warn',
        iconName: 'wallet',
        title: userCancelled ? 'لم يكتمل الدفع' : 'بانتظار دفع العربون',
        text: `موعدك محجوز لك مؤقتاً لمدة ${minutes} دقيقة. أكمل دفع العربون ليتم تأكيده ويصلك إشعار على الجوال.`,
        appointment: a,
        actions: payBtn,
      });
      document.getElementById('retry').addEventListener('click', (e) => retryPayment(e.currentTarget));
      break;
    }

    case 'expired':
      view({
        tone: 'warn',
        iconName: 'clock',
        title: 'انتهت مدة حجز الموعد',
        text: 'لم يكتمل دفع العربون خلال المدة المحددة. يمكنك المحاولة مرة أخرى إذا كان الموعد ما زال متاحاً.',
        appointment: a,
        actions: `${payBtn}<a class="btn btn-ghost" href="/book">اختيار موعد جديد</a>`,
      });
      document.getElementById('retry').addEventListener('click', (e) => retryPayment(e.currentTarget));
      break;

    case 'payment_conflict':
      view({
        tone: 'warn',
        iconName: 'alert',
        title: 'استلمنا العربون — والموعد بحاجة لإعادة جدولة',
        text: `وصل الدفع بعد انتهاء مدة الحجز وكان الوقت قد حُجز لمريض آخر. سيتواصل معك فريقنا لاختيار موعد بديل أو استرداد العربون كاملاً. للاستعجال: <bdi dir="ltr">${phone}</bdi>`,
        appointment: a,
      });
      break;

    case 'cancelled':
      view({ tone: 'danger', iconName: 'x', title: 'تم إلغاء هذا الموعد', text: `للاستفسار تواصل معنا: <bdi dir="ltr">${phone}</bdi>`, appointment: a, actions: '<a class="btn btn-primary" href="/book">احجز موعداً جديداً</a>' });
      break;

    default:
      view({ tone: 'ok', iconName: 'checkCircle', title: 'تفاصيل الحجز', text: 'شكراً لزيارتك عيادة سواك.', appointment: a, actions: '<a class="btn btn-primary" href="/book">احجز موعداً جديداً</a>' });
  }
}

load();
