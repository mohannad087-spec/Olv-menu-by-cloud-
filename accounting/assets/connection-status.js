// بانر تحذيري ثابت يظهر أعلى أي صفحة لما ينقطع الإنترنت فعليًا، ويظهر
// حالة "بانتظار المزامنة" لو في عمليات محفوظة محليًا (راجع
// offline-queue.js)، ويختفي مع تأكيد قصير لما يرجع الاتصال وتخلص المزامنة.
//
// لا نعتمد على حدثي online/offline من المتصفح لوحدهم لإظهار "لا يوجد
// اتصال" — هاي الإشارة معروف إنها غير موثوقة (بعض المتصفحات/الشبكات
// بتطلق "offline" رغم إن الإنترنت شغال فعليًا، بتذبذب لحظي بالواي فاي أو
// تبديل شبكة)، وبالاتجاه المعاكس ما بتكتشف حالة "متصل بشبكة محلية بس
// بدون إنترنت فعلي". لهذا نتحقق دايمًا بطلب شبكة حقيقي وخفيف (probe)
// قبل ما نعرض أي حالة، ونعيد الفحص دوريًا (يغطي رجوع الاتصال حتى لو حدث
// online نفسه ما انطلق لأي سبب).
(function () {
  let isOffline = false;
  let checking = false;

  function ensureBanner() {
    let el = document.getElementById("olv-connection-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "olv-connection-banner";
      el.className = "olv-connection-banner";
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function queueCount() {
    return window.olvGetOfflineQueueCount ? window.olvGetOfflineQueueCount() : 0;
  }

  function failedList() {
    return window.olvGetOfflineFailed ? window.olvGetOfflineFailed() : [];
  }

  // وصف مفهوم لعملية محفوظة (بيع بمبلغه وأصنافه، أو اسم الجدول)
  function describe(item) {
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let body = {};
    try { body = JSON.parse(item.body || "{}") || {}; } catch (e) { /* ignore */ }
    const m = /\/rest\/v1\/(rpc\/)?([^?/]+)/.exec(item.url || "");
    const name = m ? m[2] : "";
    const when = new Date(item.queued_at).toLocaleString("ar-EG", { numberingSystem: "latn", dateStyle: "short", timeStyle: "short" });
    if (name === "record_sale") {
      const amount = (Number(body.p_cash) || 0) + (Number(body.p_card) || 0) + (Number(body.p_delivery) || 0);
      return `<b>بيع ${amount.toFixed(2)}</b> · ${when}<div class="hint">${esc(String(body.p_notes || "").slice(0, 160))}</div>`;
    }
    return `<b>${esc(name || "عملية")}</b> · ${when}`;
  }

  function openFailedDialog() {
    const list = failedList();
    if (!list.length) return;
    const back = document.createElement("div");
    back.className = "olv-failed-back";
    back.innerHTML = `<div class="olv-failed-box" role="dialog" aria-modal="true">
      <h3>عمليات ما انحفظت</h3>
      <p class="hint">انحفظت وقت انقطاع النت، ولما رجع النت السيرفر رفضها. «إعادة» بتجرب ترفعها مرة ثانية (إذا انحل السبب)، و«حذف» بتلغيها نهائيًا.</p>
      ${list.map((it) => `<div class="olv-failed-row" data-id="${it.id}">
        <div>${describe(it)}<div class="olv-failed-reason">${String(it.reason || "").replace(/[&<>]/g, "")}</div></div>
        <div class="olv-failed-acts"><button type="button" class="btn small gold" data-retry>إعادة</button><button type="button" class="btn small" data-drop>حذف</button></div>
      </div>`).join("")}
      <button type="button" class="btn" data-close style="width:100%; margin-top:10px;">إغلاق</button>
    </div>`;
    const close = () => back.remove();
    back.addEventListener("click", (e) => {
      if (e.target === back || e.target.closest("[data-close]")) return close();
      const row = e.target.closest(".olv-failed-row");
      if (!row) return;
      if (e.target.closest("[data-retry]")) { window.olvRetryOfflineFailed(row.dataset.id); row.remove(); }
      else if (e.target.closest("[data-drop]") && confirm("حذف هالعملية نهائيًا؟ ما رح تنحفظ أبدًا.")) { window.olvDiscardOfflineFailed(row.dataset.id); row.remove(); }
      if (!back.querySelector(".olv-failed-row")) close();
    });
    document.body.appendChild(back);
  }

  function render() {
    const el = ensureBanner();
    const n = queueCount();
    const failed = failedList().length;
    el.onclick = null;
    el.style.cursor = "";
    if (failed && !isOffline) {
      el.textContent = `⚠️ ${failed} عملية محفوظة من وقت انقطاع النت ما انحفظت (السيرفر رفضها) — اضغط هون لتشوفها`;
      el.className = "olv-connection-banner show offline";
      el.style.cursor = "pointer";
      el.onclick = openFailedDialog;
    } else if (isOffline) {
      el.textContent = n > 0
        ? `⚠️ لا يوجد اتصال بالإنترنت — ${n} عملية محفوظة محليًا وستُرفع تلقائيًا عند رجوع الاتصال`
        : "⚠️ لا يوجد اتصال بالإنترنت — أي عملية جديدة (بيع، حفظ...) ستُحفظ محليًا وتُرفع تلقائيًا عند رجوع الاتصال";
      el.className = "olv-connection-banner show offline";
    } else if (n > 0) {
      el.textContent = `⏳ جاري رفع ${n} عملية محفوظة محليًا...`;
      el.className = "olv-connection-banner show queued";
    } else {
      el.classList.remove("show");
    }
  }

  function flashBackOnline() {
    const el = ensureBanner();
    el.textContent = "✓ رجع الاتصال بالإنترنت";
    el.className = "olv-connection-banner show online";
    setTimeout(() => { if (queueCount() === 0 && !failedList().length) el.classList.remove("show"); else render(); }, 2000);
  }

  // فحص اتصال حقيقي وخفيف: طلب HEAD بوضع no-cors لرابط مشروع Supabase
  // نفسه — ما بيهمنا نقرأ الاستجابة (opaque أصلًا بهاد الوضع)، إنجاحها
  // بس دليل كافي إنه في مسار شبكة فعلي يوصل، وفشلها (رفض الاتصال) دليل
  // انقطاع حقيقي. حد زمني 4 ثواني حتى ما يعلّق الفحص لو الشبكة بحالة
  // متذبذبة (نص متصلة)
  async function probe() {
    const cfg = window.OLV_ACCOUNTING_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.indexOf("YOUR_") === 0) return navigator.onLine;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    try {
      await fetch(cfg.SUPABASE_URL, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: controller.signal });
      return true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async function checkNow() {
    if (checking) return;
    checking = true;
    try {
      const wasOffline = isOffline;
      const reachable = await probe();
      isOffline = !reachable;
      if (reachable && window.olvFlushOfflineQueue) await window.olvFlushOfflineQueue();
      if (wasOffline && reachable && queueCount() === 0) flashBackOnline();
      else render();
    } finally {
      checking = false;
    }
  }

  window.addEventListener("online", checkNow);
  window.addEventListener("offline", checkNow);
  window.addEventListener("olv-offline-queue-change", render);
  setInterval(checkNow, 10000);
  checkNow();
})();
