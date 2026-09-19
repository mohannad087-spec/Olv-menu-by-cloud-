// هوية صوتية مميزة للبرنامج — مبنية على تركيب "جرس" حقيقي (توافقيات غير
// متناسقة/inharmonic partials، متل جرس معدني فعلي) بدل نغمات "بيب" مسطّحة،
// كلها مولّدة مباشرة عبر Web Audio API بدون أي ملف صوت خارجي. الفكرة:
// المطعم أصلًا بيستخدم جرس لتنبيه المطبخ بطلب جديد — فبدل نغمة إلكترونية
// عادية، صوت "الطلب الجديد" هون هو فعليًا محاكاة جرس خدمة حقيقي يُدَقّ
// بإلحاح (٣ دقات)، وصوت "جاهز" جرس هادئ مرة وحدة، وصوت إتمام الدفع جرس
// كاشير قديم "كِلينك-كِلانك" صاعد — كل صوت إله شخصية مختلفة عن التاني
// حتى تنعرف من نغمتها بس من غير ما تشوف الشاشة.
// المتصفحات تمنع تشغيل الصوت تلقائيًا قبل أي تفاعل من المستخدم، لذلك
// نجهّز/نفعّل سياق الصوت عند أول ضغطة أو لمسة على الصفحة
const OlvSound = (function () {
  let ctx = null;
  let noiseBuffer = null;
  let master = null;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    if (ctx && !master) {
      // فلتر تدفئة عام خفيف على كل المخرجات — بيقص حدة القمم العالية
      // جدًا فيصير الصوت أقرب لسماعة حقيقية وأبعد عن "صفير" الحاسوب
      master = ctx.createBiquadFilter();
      master.type = "lowpass";
      master.frequency.value = 9500;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  document.addEventListener("click", ensureContext, { once: true });
  document.addEventListener("touchstart", ensureContext, { once: true });

  function getNoiseBuffer(c) {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(c.sampleRate * 0.3);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  }

  // نغمة بسيطة (جيب + توافقي خفيف) — تُستخدم كطبقة تحت أصوات النقر/الحذف
  // وبصوت الخطأ (نغمتين قريبتين ببعض يعملوا "اهتزاز" طبيعي بدل بزّيز حاد)
  function tone(freq, startOffset, duration, volume, type) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + startOffset;
    const osc = c.createOscillator();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const g = c.createGain();
    const attack = Math.min(0.012, duration * 0.2);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(volume, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  // ضجيج مفلتر قصير — نقرة/طرقة "مادية" (متل زر فيزيائي أو طرح شيء)
  // بدل نغمة موسيقية
  function noiseHit(startOffset, duration, volume, freqFrom, freqTo, q) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + startOffset;
    const src = c.createBufferSource();
    src.buffer = getNoiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = q || 2.4;
    bp.frequency.setValueAtTime(freqFrom, t0);
    if (freqTo && freqTo !== freqFrom) bp.frequency.exponentialRampToValueAtTime(freqTo, t0 + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + duration);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // توافقيات "جرس" حقيقي: نسب غير متناسقة (مو ×2،×3 نضيفة) — هيك بالظبط
  // بيصير صوت جرس معدني مطروق حقيقي، لا نغمة موسيقية نضيفة. المجموعة
  // الكاملة (٥ توافقيات) لجرس المطبخ ونغمة النجاح، والمختصرة (٣) لصوت
  // "تِنك" الخفيف السريع بشاشة البيع السريع
  const BELL_FULL = [
    { ratio: 1.0, amp: 1.0, decayMul: 1.0 },
    { ratio: 2.76, amp: 0.52, decayMul: 0.72 },
    { ratio: 4.51, amp: 0.3, decayMul: 0.52 },
    { ratio: 5.4, amp: 0.2, decayMul: 0.4 },
    { ratio: 8.93, amp: 0.11, decayMul: 0.28 },
  ];
  const BELL_TINK = [
    { ratio: 1.0, amp: 1.0, decayMul: 1.0 },
    { ratio: 2.4, amp: 0.4, decayMul: 0.55 },
    { ratio: 4.1, amp: 0.16, decayMul: 0.35 },
  ];

  function ring(freq, startOffset, duration, volume, partials) {
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + startOffset;
    (partials || BELL_FULL).forEach((p) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * p.ratio;
      const dur = duration * p.decayMul;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(volume * p.amp, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  // 🔔🔔🔔 جرس المطبخ — طلب جديد وصل. ثلاث دقات متتالية بنفس النغمة
  // (متل حدا عم يدق جرس الخدمة بإلحاح "دينغ دينغ دينغ!")، عالي الصوت
  // ومختلف تمامًا عن أي صوت تاني بالبرنامج حتى ينلاحظ فورًا وسط ضجة
  // المطبخ — هاد أهم صوت بكل الهوية الصوتية
  function playNewOrder() {
    ring(1318.51, 0, 0.55, 0.44);
    ring(1318.51, 0.22, 0.6, 0.42);
    ring(1318.51, 0.44, 0.68, 0.4);
  }

  // 🔔 جرس هادئ مرة وحدة — طلب صار جاهز (يستخدم بالمطبخ لما الشيف يحدد
  // "تم التجهيز"، وبشاشة البيع السريع لتنبيه الكاشير إنه طلب جاهز
  // بالمطبخ) — نغمة مختلفة عن جرس "الطلب الجديد" (نغمة وحدة بس، أخفض)
  // حتى ينعرف الفرق من الصوت نفسه بدون قراءة الشاشة
  function playOrderReady() {
    ring(880, 0, 0.5, 0.32);
  }

  // نقرة "مادية" مميزة — طرقة ضجيج مشدودة + جسم خفيف جدًا تحتها، أقرب
  // لصوت زر آلة حقيقي من صفير شاشة لمس. تتشغّل أوتوماتيك على أي
  // زر/تبويب/بطاقة بالبرنامج (عبر مستمع النقر العام بالأسفل)
  function playClick() {
    noiseHit(0, 0.026, 0.2, 3800, 2800, 3.8);
    tone(170, 0, 0.03, 0.05, "sine");
  }

  // ⌨️🔔 "مفتاح كاشير" — أهم صوت بشاشة البيع السريع لأنه بيتكرر بكل
  // مرة الكاشير يلمس صنف: نقرة مفتاح مشدودة + "تِنك" جرسي صغير حاد فوقها
  // (متل صوت مفاتيح الكاشير المعدنية القديمة)، قصير وسريع يتحمل التكرار
  function playAdd() {
    noiseHit(0, 0.015, 0.2, 4400, 3600, 4.2);
    ring(1567.98, 0.008, 0.12, 0.26, BELL_TINK);
  }

  // طرحة/سحبة قصيرة وحاسمة — حذف صنف من التذكرة أو أي إلغاء/رفض بكل
  // البرنامج (أزرار .btn.danger كلها بتاخدها أوتوماتيك)
  function playRemove() {
    noiseHit(0, 0.1, 0.24, 1300, 480, 2.2);
    tone(170, 0.008, 0.12, 0.16, "triangle");
  }

  // 💰 "كِلينك-كِلانك" جرس كاشير قديم — نغمتين جرسيتين صاعدتين متتاليتين،
  // إحساس "الصفقة تمّت" الاحتفالي الكلاسيكي. تُستخدم لحظة إتمام الدفع
  // الفعلي وقبول طلب وارد (تسجيل بيع حقيقي) — لحظة "دخل فلوس" بالضبط
  function playSuccess() {
    ring(1046.5, 0, 0.5, 0.32);
    ring(1567.98, 0.1, 0.58, 0.3);
  }

  // نغمتين قريبتين جدًا ببعض بيعملوا "اهتزاز/نبض" طبيعي لما يشتغلوا سوا
  // — إحساس "في شي مش مظبوط" واضح بدون ما يكون بزّيز حاد مزعج. يشتغل
  // أوتوماتيك من olvShowError بكل صفحة (auth-guard.js)
  function playError() {
    tone(329.63, 0, 0.22, 0.17, "triangle");
    tone(336, 0, 0.22, 0.17, "triangle");
    tone(246.94, 0.15, 0.3, 0.17, "triangle");
    tone(252, 0.15, 0.3, 0.17, "triangle");
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
