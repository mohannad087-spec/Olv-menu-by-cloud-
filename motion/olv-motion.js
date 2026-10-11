/*
 * حركة منيو الزباين (index.html / olv-menu.html)
 * - Lenis: سكرول ناعم بعجلة الماوس/التراكباد. على الموبايل بيضل السكرول الأصلي للجهاز (أسرع وأريح).
 * - GSAP ScrollTrigger: مربوط بـLenis (نفس الساعة) — الأصناف بتطلع بهدوء لما توصلها، وعناوين الأقسام بتطلع كلمة كلمة.
 * - React Bits (motion/react-bits.js): شفق ذهبي/زيتوني ورا الشعار، النص تحت الشعار بيوضح من ضباب،
 *   لمعة على سطر الدوام، نجمة بتلف على زر «إرسال الطلب»، وشرارات عند الضغط على +.
 * لو الجهاز مفعّل «تقليل الحركة» ما بنشغّل إشي من هاد، والمنيو بيضل زي ما هو.
 */
(function () {
  'use strict';
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;
  const Bits = window.OLVBits;
  if (!gsap || !ST || !Bits) return;
  gsap.registerPlugin(ST, window.SplitText);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rail = document.querySelector('.railwrap');
  const railOffset = () => -((rail ? rail.offsetHeight : 0) + 8);

  /* ---------- Lenis + ScrollTrigger على نفس الساعة ---------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({
      autoRaf: false,
      allowNestedScroll: true,
      // السلة وتفاصيل الصنف إلهم سكرول خاص فيهم
      prevent: node => !!(node.closest && node.closest('.sheet, .itemModal'))
    });
    lenis.on('scroll', ST.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // روابط الأقسام الفرعية: نزول ناعم مع حساب الشريط اللاصق فوق
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('.subnav a[href^="#"]');
      if (!a) return;
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (!target) return;
      e.preventDefault();
      // رقم بدل العنصر: Lenis بيطرح scroll-margin-top لحاله، وإحنا بدنا العنوان يطلع تحت الشريط بالضبط
      lenis.scrollTo(target.getBoundingClientRect().top + lenis.scroll + railOffset(), { duration: 1.1 });
    });

    // لما تنفتح السلة أو تفاصيل صنف، نوقف سكرول الصفحة ورا
    const lockWhenOpen = () => {
      const open = document.querySelector('.sheet.open, .itemModal.open');
      if (open) lenis.stop(); else lenis.start();
    };
    const mo = new MutationObserver(lockWhenOpen);
    document.querySelectorAll('.sheet, .itemModal').forEach(el => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  }

  /* ---------- ظهور الأصناف وعناوين الأقسام ---------- */
  const isShown = el => el.offsetParent !== null;

  function revealRows(scope) {
    if (reduce) return;
    const rows = Array.from(scope.querySelectorAll('.row:not([data-rv])'));
    if (!rows.length) return;
    rows.forEach(r => r.setAttribute('data-rv', ''));
    gsap.set(rows, { opacity: 0, y: 14 });
    ST.batch(rows, {
      start: 'top 94%',
      once: true,
      onEnter: batch => gsap.to(batch, { opacity: 1, y: 0, duration: 0.4, ease: 'power1.out', stagger: 0.06, overwrite: true, clearProps: 'transform' })
    });
  }

  function splitHeadings(scope) {
    if (reduce) return;
    scope.querySelectorAll('.group-head h2:not([data-split])').forEach(h => {
      if (!isShown(h)) return; // اللغة التانية بنقسمها لما تنعرض
      h.setAttribute('data-split', '');
      const arabic = h.hasAttribute('data-ar');
      Bits.splitText(h, {
        splitType: arabic ? 'words' : 'chars', // تقسيم الحروف العربية بيقطع وصلها
        delay: arabic ? 70 : 28,
        duration: 0.7,
        ease: 'power3.out',
        from: { opacity: 0, y: 24 },
        to: { opacity: 1, y: 0 },
        threshold: 0.1,
        rootMargin: '-40px'
      });
    });
  }

  function decorate(scope) {
    revealRows(scope);
    splitHeadings(scope);
  }

  /* ---------- تبديل القسم (المطبخ/المشرب/…) ---------- */
  function familyShown(id) {
    if (lenis) lenis.scrollTo(0, { duration: 0.9 });
    else window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const fam = document.getElementById('fam-' + id);
    // نستنى الإطار الجاي عشان القسم الجديد ياخد مقاساته
    requestAnimationFrame(() => {
      ST.refresh();
      if (fam) decorate(fam);
    });
  }

  function langChanged() {
    const fam = document.querySelector('.family.on');
    requestAnimationFrame(() => {
      ST.refresh();
      if (fam) splitHeadings(fam);
    });
  }

  /* ---------- لمسات React Bits ---------- */
  const hero = document.querySelector('.hero');
  if (hero) {
    Bits.aurora(hero, {
      colorStops: ['#6e7c3c', '#c9a24b', '#9dab63'], // زيتوني ← ذهبي ← زيتوني فاتح (ألوان الشعار)
      direction: 'bottom',
      height: 0.32,
      amplitude: 0.9,
      blend: 0.6,
      glow: 0.5,
      brightness: 0.75,
      opacity: 0.6,
      speed: 0.8,
      layers: 2,
      dpr: 1.25 // الشفق ناعم أصلًا، دقة أقل = أخف على الموبايل
    });
    const tagline = Array.from(hero.querySelectorAll('p')).find(isShown);
    if (tagline) Bits.blurText(tagline, { delay: 90, animateBy: 'words', direction: 'top', stepDuration: 0.3 });
  }

  const hours = document.querySelector('.hours');
  if (hours) Bits.shinyText(hours, { color: '#b9ab90', shineColor: '#f2dca6', speed: 2.6, delay: 3, angle: 110, shineWidth: 30 });

  document.querySelectorAll('.cartbar .send, .sheet .send').forEach(btn => {
    Bits.starBorder(btn, {
      color: '#f2dca6', duration: 3.2, thickness: 1.5, radius: 999, trailLength: 0.35, glow: 0.7,
      hover: 'lap', clickPulse: true, trackColor: 'rgba(255,255,255,.22)'
    });
  });

  Bits.clickSpark({ selector: '.plus, .rowstep button, .modaladd', sparkColor: '#b08a3e', sparkSize: 9, sparkRadius: 20, sparkCount: 8, duration: 420 });

  const first = document.querySelector('.family.on');
  if (first) decorate(first);
  // الخط بيغيّر المقاسات لما يحمل
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ST.refresh());

  window.OLVMotion = { lenis, familyShown, langChanged, refresh: () => ST.refresh() };
})();
