    // ================= حركة الإصبع على طريقة Apple =================
    // الإسقاط بالزخم: وين رح توقف الحركة لو كمّلت بنفس سرعة الإصبع وتباطأت
    // تدريجيًا (نفس معادلة التمرير بـiOS) — منقرر الحالة النهائية حسب هاد
    // المكان المتوقَّع، مش حسب وين رفع المستخدم إصبعه، فرمية قصيرة سريعة بتكفي
    function olvProject(velocity, decel) {
      const d = decel || 0.998;
      return (velocity / 1000) * d / (1 - d);
    }
    // مقاومة مطّاطية: كل ما سحبت أبعد من الحد، كل ما لحقك العنصر أقل
    function olvRubberband(overshoot, dimension) {
      const c = 0.55;
      return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
    }
    // سرعة الإصبع (px/s) من آخر ~100ms من الحركة
    function olvVelocity(samples) {
      if (samples.length < 2) return 0;
      const last = samples[samples.length - 1];
      let first = samples[0];
      for (const p of samples) { if (last.t - p.t <= 100) { first = p; break; } }
      const dt = last.t - first.t;
      return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
    }
    function olvCurrentY(el) {
      const t = getComputedStyle(el).transform;
      return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
    }

    // ورقة سفلية بتنسحب لتحت لتتسكّر: بتلحق الإصبع 1:1 من مكان المسكة،
    // بتقاوم لفوق، وبتقرر تتسكّر أو ترجع حسب الزخم
    function olvAttachSwipeDismiss(sheet, backdrop, onDismiss) {
      let pid = null, startY = 0, y = 0, samples = [];
      sheet.addEventListener("pointerdown", (e) => {
        if (!e.target.closest(".sheet-grabber, h2") || sheet.classList.contains("closing")) return;
        pid = e.pointerId;
        sheet.setPointerCapture(pid);
        y = olvCurrentY(sheet); // نبدأ من المكان الظاهر حاليًا (ولو كانت لسا عم تتحرك)
        startY = e.clientY - y;
        sheet.classList.remove("settling");
        sheet.classList.add("dragging");
        sheet.style.transform = `translateY(${y}px)`;
        samples = [{ t: e.timeStamp, y: e.clientY }];
      });
      sheet.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pid) return;
        let d = e.clientY - startY;
        if (d < 0) d = -olvRubberband(-d, sheet.offsetHeight);
        y = d;
        sheet.style.transform = `translateY(${y}px)`;
        backdrop.style.opacity = String(1 - Math.min(Math.max(y, 0) / sheet.offsetHeight, 1));
        samples.push({ t: e.timeStamp, y: e.clientY });
        if (samples.length > 20) samples.shift();
      });
      const end = (e) => {
        if (e.pointerId !== pid) return;
        pid = null;
        const v = olvVelocity(samples);
        const projected = y + olvProject(v);
        sheet.classList.remove("dragging");
        if (projected > sheet.offsetHeight * 0.45 && y > 4) {
          sheet.style.setProperty("--sheet-y", y + "px");
          backdrop.style.setProperty("--backdrop-o", backdrop.style.opacity || "1");
          backdrop.style.opacity = "";
          onDismiss();
        } else {
          sheet.classList.add("settling");
          sheet.style.transform = "translateY(0)";
          backdrop.style.opacity = "";
        }
      };
      sheet.addEventListener("pointerup", end);
      sheet.addEventListener("pointercancel", end);
    }

    // التذكرة على الموبايل: مطوية/مفتوحة، بالضغط أو بالسحب مع الزخم.
    // الانتقال بين الحالتين بتقنية FLIP: منقيس مكان الورقة قبل وبعد تغيّر
    // الحجم، ومنحرّكها من مكانها الظاهر للمكان الجديد بدون قفزة
    document.addEventListener("DOMContentLoaded", () => {
      const panel = document.getElementById("pos-cart-panel");
      const grabber = document.getElementById("cart-grabber");
      const header = document.getElementById("ticket-header");
      const badge = document.getElementById("ticket-badge");
      const chevron = document.getElementById("cart-chevron");
      if (!panel || !grabber || !header) return;
      if (chevron && window.olvIcon) chevron.innerHTML = olvIcon("chevronDown");
      const mq = window.matchMedia("(max-width:900px)");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

      function setCollapsed(collapsed, bouncy) {
        if (panel.classList.contains("collapsed") === collapsed && !panel.style.transform) return;
        const before = panel.getBoundingClientRect().top;
        panel.classList.remove("settling");
        panel.classList.add("dragging");
        panel.style.transform = "";
        panel.classList.toggle("collapsed", collapsed);
        grabber.setAttribute("aria-expanded", String(!collapsed));
        if (!collapsed) panel.scrollTop = 0;
        if (reduce.matches) { panel.classList.remove("dragging"); return; }
        const delta = before - panel.getBoundingClientRect().top;
        panel.style.transform = `translateY(${delta}px)`;
        void panel.offsetHeight;
        panel.classList.remove("dragging");
        panel.classList.add("settling");
        panel.style.transition = bouncy ? "" : "transform .32s var(--spring)";
        panel.style.transform = "translateY(0)";
        const done = () => {
          panel.classList.remove("settling");
          panel.style.transition = "";
          panel.style.transform = "";
        };
        panel.addEventListener("transitionend", done, { once: true });
        setTimeout(done, 500);
      }

      let pid = null, startY = 0, d = 0, moved = false, samples = [];
      function down(e) {
        if (!mq.matches) return;
        pid = e.pointerId;
        e.currentTarget.setPointerCapture(pid);
        startY = e.clientY;
        d = 0; moved = false;
        samples = [{ t: e.timeStamp, y: e.clientY }];
        panel.classList.remove("settling");
      }
      function move(e) {
        if (e.pointerId !== pid) return;
        const raw = e.clientY - startY;
        if (!moved && Math.abs(raw) < 8) return; // عتبة صغيرة قبل ما نعتبرها سحبة
        if (!moved) { moved = true; panel.classList.add("dragging"); }
        const collapsed = panel.classList.contains("collapsed");
        const h = window.innerHeight;
        // مفتوحة: لتحت 1:1، لفوق مقاومة. مطوية: بالاتجاهين مقاومة (تلميح للحركة)
        d = !collapsed && raw > 0 ? raw : (raw < 0 ? -olvRubberband(-raw, h) : olvRubberband(raw, h));
        panel.style.transform = `translateY(${d}px)`;
        samples.push({ t: e.timeStamp, y: e.clientY });
        if (samples.length > 20) samples.shift();
      }
      function up(e) {
        if (e.pointerId !== pid) return;
        pid = null;
        panel.classList.remove("dragging");
        const collapsed = panel.classList.contains("collapsed");
        if (!moved) { setCollapsed(!collapsed, false); return; }
        const projected = d + olvProject(olvVelocity(samples));
        if (collapsed && projected < -40) setCollapsed(false, true);
        else if (!collapsed && projected > 120) setCollapsed(true, true);
        else {
          panel.classList.add("settling");
          panel.style.transform = "translateY(0)";
          panel.addEventListener("transitionend", () => {
            panel.classList.remove("settling");
            panel.style.transform = "";
          }, { once: true });
        }
      }
      [grabber, header].forEach((el) => {
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
      grabber.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed(!panel.classList.contains("collapsed"), false); }
      });

      // الدفع/الحفظ وهي مطوية: منفتحها أول (قبل معالج الزر نفسه) حتى لو
      // ناقص رقم هاتف (توصيل)، الحقل يكون ظاهر لما يتركّز عليه
      panel.addEventListener("click", (e) => {
        if (mq.matches && panel.classList.contains("collapsed") && e.target.closest("#checkout-btn, #save-draft-btn")) {
          setCollapsed(false, false);
        }
      }, true);

      // نبضة على العدّاد لما يزيد، وطي التذكرة لما تفضى (بعد بيعة مثلًا)
      let lastCount = Number(badge.textContent) || 0;
      new MutationObserver(() => {
        const n = Number(badge.textContent) || 0;
        if (n > lastCount) {
          badge.classList.remove("bump");
          void badge.offsetWidth;
          badge.classList.add("bump");
        }
        if (n === 0 && lastCount > 0 && mq.matches) setCollapsed(true, false);
        lastCount = n;
      }).observe(badge, { childList: true, characterData: true, subtree: true });
    });
