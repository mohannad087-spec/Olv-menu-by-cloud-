// يفحص الطلبات الواردة من موقع المنيو الحقيقي دوريًا (كل ١٥ ثانية) على
// أي صفحة من صفحات المحاسبة — يحدّث عداد صغير على تبويب "الطلبات الواردة"
// بشريط التنقل (زي إشعارات الهاتف)، وينبّه بصوت لما يوصل طلب جديد فعليًا
// (مو أول تحميل للصفحة). صفحة incoming-orders.html نفسها تعيد استخدام
// نفس الوحدة (subscribe/pollNow/callProxy) بدل ما تعمل استعلام مستقل،
// حتى ما يصير نداء شبكة مضاعف ولا صوت مكرر وقت ما تكون هي الصفحة المفتوحة.
const OlvIncomingPoll = (function () {
  let accessToken = null;
  let knownNewIds = null; // null = لسا ما انعمل الأساس الأول (baseline)
  let lastOrders = null;
  const subscribers = [];
  let started = false;

  function proxyUrl() {
    const base = (window.OLV_ACCOUNTING_CONFIG || {}).SUPABASE_URL || "";
    return base.replace(/\/$/, "") + "/functions/v1/olv-menu-proxy";
  }

  async function callProxy(payload) {
    if (!accessToken) {
      const { data } = await window.supabaseClient.auth.getSession();
      accessToken = data && data.session && data.session.access_token;
    }
    if (!accessToken) throw new Error("لا توجد جلسة دخول");
    const res = await fetch(proxyUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok || out.ok === false) throw new Error(out.error || "فشل الاتصال بموقع المنيو");
    return out;
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

  async function poll() {
    try {
      const out = await callProxy({ action: "list" });
      const orders = out.orders || [];
      lastOrders = orders;
      updateBadge(orders.filter((o) => o.status === "new").length);
      checkForNew(orders);
      subscribers.forEach((fn) => fn(orders));
      return orders;
    } catch (e) {
      return null;
    }
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
    setInterval(poll, 15000);
  }

  function subscribe(fn) {
    subscribers.push(fn);
    if (lastOrders) fn(lastOrders);
  }

  return { start, pollNow: poll, subscribe, callProxy };
})();

OlvIncomingPoll.start();
