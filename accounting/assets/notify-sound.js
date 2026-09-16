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

  return { playNewOrder, playOrderReady, ensureContext };
})();
