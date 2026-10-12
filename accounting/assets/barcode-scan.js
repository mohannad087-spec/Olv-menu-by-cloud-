// مسح الباركود: بجهاز الماسح (وايرلس/USB) أو بكاميرا التلفون.
//
// - جهاز الماسح بيشتغل كأنه كيبورد: بيكتب الأرقام بسرعة كتير وبعدين Enter. منلقط هالكتابة
//   السريعة من أي مكان بالصفحة (حتى لو المؤشر بخانة الكمية) ومنشيل الأرقام اللي انكتبت بالغلط.
// - الكاميرا: منستعمل BarcodeDetector المدمج بالمتصفح (كروم أندرويد)، وإذا مش موجود (آيفون)
//   منحمّل مكتبة ZXing (محفوظة عنا) بس وقت ما تفتح الكاميرا.

(function () {
  const MIN_LEN = 6;      // أقصر باركود منقبله من الماسح (EAN-8 = 8، بس في أكواد داخلية أقصر شوي)
  const MAX_GAP = 45;     // الماسح بيكتب الحرف ورا الحرف بأقل من هيك (الإنسان أبطأ بكتير)

  // يلقط كتابة الماسح من أي مكان. onCode(code) بيرجع true إذا الكود انستعمل.
  window.olvBarcodeListen = function (onCode) {
    let buf = "", last = 0, target = null;
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (now - last > MAX_GAP * 2) { buf = ""; target = e.target; }
      last = now;
      if (e.key === "Enter") {
        const code = buf; buf = "";
        if (code.length < MIN_LEN) return;
        e.preventDefault(); e.stopPropagation();
        // الأرقام انكتبت بالخانة اللي كان فيها المؤشر — منشيلها
        const el = target;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && typeof el.value === "string" && el.value.endsWith(code)) {
          try { el.value = el.value.slice(0, -code.length); el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
        }
        onCode(code);
        return;
      }
      if (e.key.length === 1 && /[0-9A-Za-z\-]/.test(e.key)) buf += e.key;
      else if (e.key !== "Shift") buf = "";
    }, true);
  };

  // مكتبة ZXing (Apache-2.0) محفوظة عنا بـassets/vendor، فما بتعتمد على موقع خارجي
  const ZXING_URL = new URL("vendor/zxing-library-0.21.3.min.js", document.currentScript ? document.currentScript.src : location.href).href;
  let zxingLoad = null;
  function loadZXing() {
    if (window.ZXing) return Promise.resolve();
    if (!zxingLoad) zxingLoad = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = ZXING_URL; s.onload = res; s.onerror = () => { zxingLoad = null; rej(new Error("ما قدرنا نحمّل قارئ الباركود — حدّث الصفحة وجرّب")); };
      document.head.appendChild(s);
    });
    return zxingLoad;
  }

  // يفتح الكاميرا بشاشة كاملة ويضل يمسح لحد ما تسكّرها.
  // onCode(code) بيرجع نص قصير ينعرض تحت (مثل "＋ سكر") أو Promise إله.
  window.olvBarcodeCamera = function (onCode) {
    const back = document.createElement("div");
    back.className = "olv-scan";
    back.setAttribute("role", "dialog");
    back.setAttribute("aria-label", "مسح باركود بالكاميرا");
    back.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="olv-scan-frame" aria-hidden="true"><i></i></div>
      <div class="olv-scan-bar">
        <div class="olv-scan-msg" aria-live="polite">وجّه الكاميرا على الباركود</div>
        <button type="button" class="btn gold olv-scan-done">خلصت</button>
      </div>`;
    document.body.appendChild(back);
    const video = back.querySelector("video");
    const msg = back.querySelector(".olv-scan-msg");
    let stream = null, timer = null, reader = null, closed = false, busy = false;
    let lastCode = "", lastAt = 0;

    function close() {
      closed = true;
      clearInterval(timer);
      try { reader && reader.reset(); } catch (_) {}
      if (stream) stream.getTracks().forEach((t) => t.stop());
      back.remove();
      document.removeEventListener("keydown", onKey);
    }
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.querySelector(".olv-scan-done").addEventListener("click", close);

    async function got(code) {
      code = String(code || "").trim();
      if (!code || busy || closed) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < 2000) return; // نفس الكود لسا قدام الكاميرا
      lastCode = code; lastAt = now; busy = true;
      if (navigator.vibrate) navigator.vibrate(60);
      back.classList.remove("hit"); void back.offsetWidth; back.classList.add("hit");
      try {
        const r = await onCode(code);
        if (!closed) msg.textContent = r || code;
      } catch (e) { if (!closed) msg.textContent = (e && e.message) || String(e); }
      busy = false; lastAt = Date.now();
    }

    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("هالمتصفح ما بيسمح بالكاميرا — افتح البرنامج من كروم أو سفاري");
        const native = "BarcodeDetector" in window && (await window.BarcodeDetector.getSupportedFormats().catch(() => [])).includes("ean_13");
        if (native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream; await video.play().catch(() => {});
          const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] });
          timer = setInterval(async () => {
            if (busy || closed || video.readyState < 2) return;
            try { const r = await det.detect(video); if (r && r[0]) got(r[0].rawValue); } catch (_) {}
          }, 180);
        } else {
          msg.textContent = "عم نجهّز القارئ…";
          await loadZXing();
          if (closed) return;
          reader = new window.ZXing.BrowserMultiFormatReader();
          await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (res) => { if (res) got(res.getText()); });
          stream = video.srcObject;
          msg.textContent = "وجّه الكاميرا على الباركود";
        }
      } catch (e) {
        const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
        msg.textContent = denied ? "الكاميرا مقفلة — اسمح للبرنامج يستعمل الكاميرا من إعدادات المتصفح وجرّب مرة تانية" : ((e && e.message) || "ما اشتغلت الكاميرا");
      }
    })();
    return { close };
  };
})();
