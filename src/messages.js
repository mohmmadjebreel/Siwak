// نصوص رسائل SMS. حافظ عليها قصيرة: الرسالة العربية الواحدة = 70 حرفاً.
import { clinic, getDoctor, getService } from './clinic.js';
import { formatDateAr, formatTimeAr } from './time.js';
import { formatMoney } from './util.js';

export function otpMessage(code) {
  return `سواك: رمز التحقق ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`;
}

export function confirmationMessage(appt) {
  const service = getService(appt.service_id)?.name || '';
  const doctor = getDoctor(appt.doctor_id)?.name || '';
  return [
    `سواك: تم تأكيد موعدك`,
    `${service} - ${doctor}`,
    `${formatDateAr(appt.date)} الساعة ${formatTimeAr(appt.time)}`,
    `رقم الحجز: ${appt.ref}`,
    `العربون المدفوع: ${formatMoney(appt.deposit_amount, appt.currency)}`,
  ].join('\n');
}

export function reminderMessage(appt) {
  return [
    `سواك: تذكير بموعدك ${formatDateAr(appt.date)} الساعة ${formatTimeAr(appt.time)}`,
    `رقم الحجز ${appt.ref}. للتعديل: ${clinic.phone}`,
  ].join('\n');
}

export function cancellationMessage(appt) {
  return `سواك: تم إلغاء موعدك رقم ${appt.ref}.\nللاستفسار: ${clinic.phone}`;
}

export function conflictMessage(appt) {
  return `سواك: وصلنا عربون الحجز ${appt.ref} لكن الموعد لم يعد متاحاً. سنتواصل معك لاختيار موعد آخر أو استرداد المبلغ.`;
}
