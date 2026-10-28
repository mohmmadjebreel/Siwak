import { api, DAYS, esc, icon, money, timeLabel } from './common.js';

function hoursText(ranges) {
  if (!ranges.length) return 'مغلق';
  return ranges.map(([a, b]) => `${timeLabel(a)} – ${timeLabel(b)}`).join('، ');
}

async function init() {
  const clinic = await api('/api/clinic');

  document.getElementById('services-grid').innerHTML = clinic.services
    .map(
      (s) => `
      <a class="service-card" href="/book?service=${encodeURIComponent(s.id)}">
        <span class="ic">${icon(s.icon)}</span>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.description)}</p>
        <div class="service-meta">
          <span class="muted">يبدأ من ${esc(money(s.priceFrom, clinic.currency))}</span>
          <b>احجز ←</b>
        </div>
      </a>`,
    )
    .join('');

  const serviceName = (id) => clinic.services.find((s) => s.id === id)?.name || '';
  document.getElementById('doctors-grid').innerHTML = clinic.doctors
    .map(
      (d) => `
      <div class="doctor-card">
        <div class="avatar">${esc(d.name.replace(/^د\.\s*/, '').charAt(0))}</div>
        <h3>${esc(d.name)}</h3>
        <p>${esc(d.title)}</p>
        <div class="doctor-days">${d.services
          .slice(0, 4)
          .map((id) => `<span class="pill pill-brand">${esc(serviceName(id))}</span>`)
          .join('')}</div>
      </div>`,
    )
    .join('');

  const address = document.getElementById('c-address');
  address.textContent = clinic.address;
  address.href = clinic.mapUrl;
  const phone = document.getElementById('c-phone');
  phone.textContent = clinic.phone;
  phone.href = `tel:${clinic.phone.replace(/\s/g, '')}`;
  document.getElementById('c-whatsapp').href = `https://wa.me/${clinic.whatsapp}`;

  // Saturday first, as the week is commonly read in the region.
  const order = [6, 0, 1, 2, 3, 4, 5];
  document.getElementById('c-hours').innerHTML = order
    .map((d) => `<li><span>${DAYS[d]}</span><span>${esc(hoursText(clinic.hours[d] || []))}</span></li>`)
    .join('');

  document.querySelectorAll('[data-cancel-hours]').forEach((el) => (el.textContent = clinic.cancelHours));
}

init().catch((err) => {
  document.getElementById('services-grid').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
});
