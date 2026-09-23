// يفحص دوريًا (كل ٦٠ ثانية) المواد الخام والمستلزمات اللي وصلت حدّها
// الأدنى المسموح بالمخزون — يحدّث عداد صغير على تبويبي "المخزون"
// و"المستلزمات" بشريط التنقل (زي عداد الطلبات الواردة)، وينبّه بصوت +
// إشعار مؤقت لما صنف "جديد" فعليًا يوصل الحد الأدنى (مو أول تحميل
// للصفحة، ومو تكرار لصنف أصلًا منبّه عليه) — يشتغل بأي صفحة مفتوحة
const OlvLowStockPoll = (function () {
  let knownLowIds = null; // null = لسا ما انعمل الأساس الأول (baseline)
  const subscribers = [];
  let started = false;

  function updateBadge(href, count) {
    const tab = document.querySelector(`.tab-link[href="${href}"]`);
    if (!tab) return;
    let badge = tab.querySelector(".tab-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "tab-badge";
        tab.appendChild(badge);
      }
      badge.textContent = count > 99 ? "99+" : String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.style.cssText = [
      "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
      "background:var(--danger)", "color:#fff", "padding:12px 22px", "border-radius:10px",
      "font-size:14px", "font-weight:700", "z-index:100", "box-shadow:0 4px 16px rgba(0,0,0,.3)",
      "max-width:90vw", "text-align:center",
    ].join(";");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function checkForNew(items) {
    const currentIds = new Set(items.map((i) => i.id));
    if (knownLowIds === null) { knownLowIds = currentIds; return; }
    const newItems = items.filter((i) => !knownLowIds.has(i.id));
    knownLowIds = currentIds;
    if (newItems.length) {
      if (typeof OlvSound !== "undefined") OlvSound.playError();
      const names = newItems.slice(0, 3).map((i) => i.name).join("، ");
      const extra = newItems.length > 3 ? ` و${newItems.length - 3} غيرها` : "";
      showToast(`⚠️ نقص مخزون: ${names}${extra}`);
    }
  }

  async function poll() {
    try {
      const { data, error } = await window.supabaseClient.from("low_stock_items").select("*");
      if (error) return null;
      const items = data || [];
      const ingredientCount = items.filter((i) => i.item_type === "ingredient").length;
      const supplyCount = items.filter((i) => i.item_type === "supply").length;
      updateBadge("inventory.html", ingredientCount);
      updateBadge("supplies.html", supplyCount);
      checkForNew(items);
      subscribers.forEach((fn) => fn(items));
      return items;
    } catch (e) {
      return null;
    }
  }

  function start() {
    if (started) return;
    started = true;
    // نأجّل أول فحص لبعد ما باقي سكربتات الصفحة (وبالأخص olvRenderNav)
    // تخلّص، زي نفس أسلوب OlvIncomingPoll تمامًا
    setTimeout(poll, 0);
    setInterval(poll, 60000);
  }

  function subscribe(fn) {
    subscribers.push(fn);
  }

  return { start, pollNow: poll, subscribe };
})();

OlvLowStockPoll.start();
