// بيانات العيادة — عدّل هذا الملف ليطابق عيادتك (الخدمات، الأطباء، ساعات الدوام، العربون).
// Clinic data — edit this file to match the real clinic.

export const clinic = {
  name: 'سواك',
  fullName: 'عيادة سواك لطب وتجميل الأسنان',
  tagline: 'ابتسامة صحية تبدأ من موعد واحد',
  phone: '+970 59 000 0000',
  whatsapp: '970590000000',
  email: 'info@siwak.clinic',
  address: 'رام الله — شارع الإرسال، مجمع الصحة، الطابق الثاني',
  mapUrl: 'https://maps.google.com/?q=Ramallah',

  // طول الخانة الزمنية بالدقائق
  slotMinutes: 30,
  // كم يوماً للأمام يمكن الحجز
  bookingWindowDays: 30,
  // أقل مدة (بالدقائق) بين الآن وبداية الموعد
  minLeadMinutes: 120,
  // سياسة الإلغاء: استرداد العربون إذا ألغي قبل هذا العدد من الساعات
  cancelHours: 24,

  // ساعات الدوام حسب اليوم: 0 = الأحد ... 5 = الجمعة، 6 = السبت
  hours: {
    0: [['09:00', '13:00'], ['16:00', '21:00']],
    1: [['09:00', '13:00'], ['16:00', '21:00']],
    2: [['09:00', '13:00'], ['16:00', '21:00']],
    3: [['09:00', '13:00'], ['16:00', '21:00']],
    4: [['09:00', '13:00'], ['16:00', '21:00']],
    5: [],
    6: [['10:00', '17:00']],
  },

  // المبالغ بالعملة المحددة في CURRENCY (افتراضياً شيكل). العربون يُخصم من قيمة الجلسة.
  services: [
    {
      id: 'checkup',
      name: 'فحص واستشارة',
      description: 'فحص شامل للفم والأسنان مع صورة بانوراما وخطة علاج واضحة.',
      durationMin: 30,
      priceFrom: 50,
      deposit: 20,
      icon: 'search',
    },
    {
      id: 'cleaning',
      name: 'تنظيف وتلميع',
      description: 'إزالة الجير والتصبغات وتلميع الأسنان بأجهزة الموجات فوق الصوتية.',
      durationMin: 30,
      priceFrom: 100,
      deposit: 20,
      icon: 'sparkle',
    },
    {
      id: 'filling',
      name: 'حشوات تجميلية',
      description: 'حشوات بلون السن الطبيعي تعيد للسن شكله وقوته.',
      durationMin: 60,
      priceFrom: 150,
      deposit: 50,
      icon: 'tooth',
    },
    {
      id: 'root-canal',
      name: 'علاج العصب',
      description: 'علاج قنوات الجذر بأحدث الأجهزة الدوّارة وبأقل ألم ممكن.',
      durationMin: 90,
      priceFrom: 400,
      deposit: 100,
      icon: 'shield',
    },
    {
      id: 'whitening',
      name: 'تبييض الأسنان',
      description: 'تبييض آمن داخل العيادة بنتيجة تظهر من الجلسة الأولى.',
      durationMin: 60,
      priceFrom: 500,
      deposit: 100,
      icon: 'sun',
    },
    {
      id: 'orthodontics',
      name: 'تقويم الأسنان',
      description: 'تقويم معدني، خزفي أو شفاف حسب حالتك واحتياجك.',
      durationMin: 60,
      priceFrom: 2500,
      deposit: 200,
      icon: 'align',
    },
    {
      id: 'implants',
      name: 'زراعة الأسنان',
      description: 'تعويض الأسنان المفقودة بزرعات ثابتة تدوم طويلاً.',
      durationMin: 90,
      priceFrom: 2000,
      deposit: 200,
      icon: 'anchor',
    },
    {
      id: 'veneers',
      name: 'ابتسامة هوليوود',
      description: 'قشور خزفية (فينير) لتصميم ابتسامة متناسقة وطبيعية.',
      durationMin: 60,
      priceFrom: 700,
      deposit: 150,
      icon: 'smile',
    },
  ],

  // ملاحظة: هذه أسماء تجريبية — استبدلها بأسماء أطباء العيادة الحقيقيين.
  doctors: [
    {
      id: 'dr-1',
      name: 'د. أحمد',
      title: 'طب أسنان عام وتجميل',
      services: ['checkup', 'cleaning', 'filling', 'whitening', 'veneers'],
      days: [0, 1, 2, 3, 4, 6],
    },
    {
      id: 'dr-2',
      name: 'د. سارة',
      title: 'أخصائية تقويم الأسنان',
      services: ['checkup', 'orthodontics', 'cleaning'],
      days: [0, 2, 4, 6],
    },
    {
      id: 'dr-3',
      name: 'د. ليث',
      title: 'أخصائي جراحة وزراعة الأسنان',
      services: ['checkup', 'root-canal', 'implants', 'filling'],
      days: [0, 1, 3, 4],
    },
  ],
};

export function getService(id) {
  return clinic.services.find((s) => s.id === id) || null;
}

export function getDoctor(id) {
  return clinic.doctors.find((d) => d.id === id) || null;
}
