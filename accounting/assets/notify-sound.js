// نغمات تنبيه بسيطة تُولَّد مباشرة عبر Web Audio API (بدون أي ملف صوت خارجي)
// المتصفحات تمنع تشغيل الصوت تلقائيًا قبل أي تفاعل من المستخدم، لذلك
// نجهّز/نفعّل سياق الصوت عند أول ضغطة أو لمسة على الصفحة
const OlvSound = (function () {
  let ctx = null;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  document.addEventListener("click", ensureContext, { once: true });
  document.addEventListener("touchstart", ensureContext, { once: true });

  function beep(freq, startOffset, duration, volume) {
    const c = ensureContext();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t0 = c.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  // نغمة مزدوجة لافتة للانتباه — طلب جديد وصل للمطبخ
  function playNewOrder() {
    beep(880, 0, 0.15, 0.35);
    beep(1108, 0.18, 0.18, 0.35);
  }

  // نغمة أهدأ — طلب صار جاهزًا
  function playOrderReady() {
    beep(660, 0, 0.12, 0.3);
    beep(880, 0.14, 0.22, 0.3);
  }

  // نقرة خفيفة جدًا — تُشغَّل تلقائيًا على أي زر/تبويب/بطاقة يُضغط عليها
  // بالبرنامج (عبر مستمع النقر العام بالأسفل)
  function playClick() {
    beep(720, 0, 0.045, 0.13);
  }

  // صوت إضافة صنف — لمسة أوضح شوي من النقرة العادية، بتنعاد كتير
  // بشاشة البيع السريع فبلازم تضل خفيفة وسريعة
  function playAdd() {
    beep(520, 0, 0.055, 0.2);
    beep(760, 0.045, 0.08, 0.2);
  }

  // صوت حذف/إلغاء/رفض — نغمة هابطة قصيرة، أخف من صوت الخطأ
  function playRemove() {
    beep(420, 0, 0.08, 0.2);
    beep(280, 0.06, 0.11, 0.18);
  }

  // صوت نجاح — إتمام دفع/حفظ/قبول طلب
  function playSuccess() {
    beep(660, 0, 0.09, 0.26);
    beep(880, 0.09, 0.1, 0.26);
    beep(1180, 0.18, 0.16, 0.26);
  }

  // صوت خطأ — يتشغّل أوتوماتيك من olvShowError بكل صفحة (auth-guard.js)
  function playError() {
    beep(320, 0, 0.1, 0.26);
    beep(210, 0.09, 0.18, 0.24);
  }

  // مستمع نقر عام على كامل الصفحة: يشغّل نقرة خفيفة على أي زر/رابط-زر/
  // تبويب/بطاقة منتج بدون ما نحتاج نربط صوت يدويًا بكل زر بكل صفحة.
  // لو العنصر معمول له data-sound="add|remove|success" (مضبوطة بقالب
  // العنصر بالـHTML) بيشتغل الصوت المناسب بدل النقرة العادية، وأزرار
  // "حذف/إلغاء/رفض" (كلها بصنف btn danger بكل الصفحات) بتاخد صوت الحذف
  // أوتوماتيك بدون أي وسم إضافي
  // بتنادي عبر OlvSound.playX (لا عبر استدعاء الدوال المحلية مباشرة) حتى
  // لو حد بدّل إحدى الدوال بعد التصدير (متل ما بتعمل ملفات الاختبار
  // للتجسس عليها) ينطبق التبديل هون كمان
  document.addEventListener("click", (e) => {
    const target = e.target.closest(
      "[data-sound], button:not(:disabled), .btn:not([disabled]), a.btn, .tab-link, .sub-tab, .cat-tab, .pm-tile, .qty-stepper button, .card[data-id]"
    );
    if (!target || target.disabled) return;
    const kind = target.dataset.sound || (target.classList.contains("danger") ? "remove" : "click");
    if (kind === "add") OlvSound.playAdd();
    else if (kind === "remove") OlvSound.playRemove();
    else if (kind === "success") OlvSound.playSuccess();
    else if (kind === "none") return;
    else OlvSound.playClick();
  });

  return { playNewOrder, playOrderReady, playClick, playAdd, playRemove, playSuccess, playError, ensureContext };
})();
