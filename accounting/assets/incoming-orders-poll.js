// يفحص الطلبات الواردة من موقع المنيو الحقيقي دوريًا (كل ١٥ ثانية) على
// أي صفحة من صفحات المحاسبة — يحدّث عداد صغير على تبويب "الطلبات الواردة"
// بشريط التنقل (زي إشعارات الهاتف)، وينبّه بصوت لما يوصل طلب جديد فعليًا
// (مو أول تحميل للصفحة). صفحة incoming-orders.html نفسها تعيد استخدام
// نفس الوحدة (subscribe/pollNow/callProxy) بدل ما تعمل استعلام مستقل،
// حتى ما يصير نداء شبكة مضاعف ولا صوت مكرر وقت ما تكون هي الصفحة المفتوحة.
//
// ملاحظات موثوقية (إصلاح تأخر/ضياع الطلبات):
// - رمز الدخول بينتهي كل ساعة؛ كنا نحفظه مرة وحدة للأبد، فبعد ساعة كل فحص يرجع 401 بصمت
//   وما يوصل ولا طلب لحد ما حدا يحدّث الصفحة. هلق بناخد الرمز الحالي من Supabase مع كل نداء
//   (بيتجدد لحاله)، ولو انرفض بنجدده ونعيد مرة.
// - المتصفح بيبطّئ المؤقتات بالتبويب المخفي (لحد مرة بالدقيقة)، فبنفحص فورًا لما الصفحة ترجع
//   تنعرض أو يرجع النت.
// - الفشل ما عاد صامت: الصفحة بتعرض السبب (onError) والعداد بيصير "!".
const OlvIncomingPoll = (function () {
  const POLL_MS = 10000;
  let knownNewIds = null; // null = لسا ما انعمل الأساس الأول (baseline)
  let lastOrders = null;
  const subscribers = [];
  const errorSubscribers = [];
  let lastError = null;
  let inFlight = null;
  let started = false;

  function proxyUrl() {
    const base = (window.OLV_ACCOUNTING_CONFIG || {}).SUPABASE_URL || "";
    return base.replace(/\/$/, "") + "/functions/v1/olv-menu-proxy";
  }

  async function currentToken(forceRefresh) {
    const auth = window.supabaseClient.auth;
    const { data } = forceRefresh ? await auth.refreshSession() : await auth.getSession();
    return data && data.session && data.session.access_token;
  }

  // رسائل أوضح لأشهر الأعطال بدل نص السيرفر الخام
  function friendlyError(status, msg) {
    if (status === 403 && /Admin access required/i.test(msg || "")) {
      return "موقع المنيو رفض مفتاح الإدارة — المفتاح OLV_ADMIN_KEY بأسرار Supabase لازم يكون نفسه بالضبط بأسرار Cloudflare Pages (مشروع olv-menu). لحد ما يتصلّح ما رح توصل طلبات المنيو هون.";
    }
    // موقع المنيو بيرجّع أحيانًا صفحة خطأ HTML (انقطاع لحظي من Cloudflare) بدل بيانات
    if (/DOCTYPE|not valid JSON|Unexpected token/i.test(msg || "")) {
      return "موقع المنيو ما ردّ صح للحظة (صفحة خطأ بدل البيانات) — عم نعيد المحاولة تلقائيًا، وإذا استمر أكتر من دقيقتين خبّرني.";
    }
    if (status === 429) return "موقع المنيو قفل الاتصال مؤقتًا بسبب محاولات مفتاح غلط كثيرة — بيرجع لحاله خلال ربع ساعة.";
    return msg || "فشل الاتصال بموقع المنيو";
  }

  async function callProxy(payload) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await currentToken(attempt > 0);
      if (!token) throw new Error("لا توجد جلسة دخول — سجّل دخول من جديد");
      let res, out;
      try {
        res = await fetch(proxyUrl(), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        out = await res.json().catch(() => ({}));
      } catch (e) {
        throw new Error("ما في اتصال بالنت أو السيرفر ما رد");
      }
      if (res.ok && out.ok !== false) return out;
      lastErr = new Error(friendlyError(res.status, out.error));
      // خطأ لحظي من موقع المنيو (500 + رد غير JSON): ننتظر ثانية ونعيد مرة وحدة قبل ما نعرض خطأ
      if (res.status >= 500 && attempt === 0 && /DOCTYPE|not valid JSON|Unexpected token/i.test(out.error || "")) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      // 401 = رمز الدخول انتهى: نجدده ونعيد مرة وحدة
      if (res.status !== 401) break;
    }
    throw lastErr;
  }

  function updateBadge(pendingCount) {
    const tab = document.querySelector('.tab-link[href="incoming-orders.html"]');
    if (!tab) return;
    let badge = tab.querySelector(".tab-badge");
    if (pendingCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "tab-badge";
        tab.appendChild(badge);
      }
      badge.textContent = pendingCount > 99 ? "99+" : String(pendingCount);
    } else if (badge) {
      badge.remove();
    }
  }

  function checkForNew(orders) {
    const currentIds = new Set(orders.filter((o) => o.status === "new").map((o) => o.id));
    if (knownNewIds === null) { knownNewIds = currentIds; return; }
    let hasNew = false;
    currentIds.forEach((id) => { if (!knownNewIds.has(id)) hasNew = true; });
    knownNewIds = currentIds;
    if (hasNew && typeof OlvSound !== "undefined") OlvSound.playNewOrder();
  }

  function setError(err) {
    lastError = err;
    errorSubscribers.forEach((fn) => fn(err));
    if (err) {
      const tab = document.querySelector('.tab-link[href="incoming-orders.html"]');
      if (tab) {
        let badge = tab.querySelector(".tab-badge");
        if (!badge) { badge = document.createElement("span"); badge.className = "tab-badge"; tab.appendChild(badge); }
        badge.textContent = "!";
        badge.title = err.message;
      }
    }
  }

  async function doPoll() {
    try {
      const out = await callProxy({ action: "list" });
      const orders = out.orders || [];
      lastOrders = orders;
      if (lastError) setError(null);
      updateBadge(orders.filter((o) => o.status === "new").length);
      checkForNew(orders);
      subscribers.forEach((fn) => fn(orders));
      return orders;
    } catch (e) {
      setError(e);
      return null;
    }
  }

  // ما منخلي فحصين يشتغلوا بنفس الوقت (المؤقت + رجوع التبويب مثلًا)
  function poll() {
    if (!inFlight) inFlight = doPoll().finally(() => { inFlight = null; });
    return inFlight;
  }

  function start() {
    if (started) return;
    started = true;
    // نأجّل أول فحص إلى macrotask (بدل نداء poll() مباشرة) حتى نضمن إنه
    // ينفّذ بعد ما باقي سكربتات الصفحة (وبالأخص السكربت الأخير يلي بيرسم
    // شريط التنقل عبر olvRenderNav) خلصت تنفيذها الأول — إذا كل الوعود
    // بهالسلسلة اترجعت فورًا (متل بيئة الاختبار)، ممكن poll() يخلص كامل
    // (وصولًا لتحديث DOM شريط التنقل) قبل ما الشريط نفسه يترسم أصلًا.
    setTimeout(poll, 0);
    setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
    window.addEventListener("focus", () => poll());
    window.addEventListener("online", () => poll());
  }

  function subscribe(fn) {
    subscribers.push(fn);
    if (lastOrders) fn(lastOrders);
  }

  function onError(fn) {
    errorSubscribers.push(fn);
    if (lastError) fn(lastError);
  }

  return { start, pollNow: poll, subscribe, onError, callProxy };
})();

OlvIncomingPoll.start();
