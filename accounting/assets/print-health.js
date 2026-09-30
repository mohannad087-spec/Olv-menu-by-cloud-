// شريط تحذير أحمر لو الطباعة "ساكتة" بمشكلة: برنامج الطباعة (print-bridge)
// متوقف، أو مهمة طباعة عالقة أكتر من دقيقة، أو مهام فشلت مؤخرًا. بدون هالشي،
// الكاشير بيشوف "تم البيع" والمطبخ ما بيوصله شي وما حدا بيعرف. بيتحقق كل
// ٢٠ ثانية من أي صفحة، وما بيعرض شي لو الطباعة الآلية غير مفعّلة أصلًا.
const OlvPrintHealth = (function () {
  const CHECK_MS = 20000;
  const STUCK_PENDING_SEC = 60;
  const HEARTBEAT_STALE_SEC = 120;
  const RECENT_ERROR_HOURS = 3;

  function banner() {
    let el = document.getElementById("olv-print-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "olv-print-banner";
      el.className = "olv-connection-banner offline";
      const nav = document.getElementById("olv-nav");
      if (nav && nav.parentNode) nav.parentNode.insertBefore(el, nav.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function show(msg) {
    const el = banner();
    el.innerHTML = `${msg} — <a href="settings.html" style="color:inherit; text-decoration:underline;">فحص الطباعة</a>`;
    el.classList.add("show");
  }

  function hide() {
    const el = document.getElementById("olv-print-banner");
    if (el) el.classList.remove("show");
  }

  async function check() {
    const sb = window.supabaseClient;
    if (!sb || navigator.onLine === false) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      const [printersRes, settingsRes, pendingRes, errorRes, hbRes] = await Promise.all([
        sb.from("printers").select("enabled"),
        sb.from("printer_settings").select("kitchen_enabled, receipt_enabled").eq("id", 1).maybeSingle(),
        sb.from("print_jobs").select("id, created_at").eq("status", "pending"),
        sb.from("print_jobs").select("id, created_at").eq("status", "error"),
        sb.from("app_settings").select("value").eq("key", "print_bridge_heartbeat").maybeSingle(),
      ]);
      if (pendingRes.error || errorRes.error) return;

      const s = settingsRes.data || {};
      const enabled = ((printersRes.data || []).some((p) => p.enabled)) || s.kitchen_enabled || s.receipt_enabled;
      if (!enabled) { hide(); return; }

      const now = Date.now();
      const stuck = (pendingRes.data || []).filter((j) => now - new Date(j.created_at).getTime() > STUCK_PENDING_SEC * 1000);
      const recentErrors = (errorRes.data || []).filter((j) => now - new Date(j.created_at).getTime() < RECENT_ERROR_HOURS * 3600000);
      const hb = hbRes.data && hbRes.data.value ? new Date(hbRes.data.value).getTime() : 0;
      const bridgeDown = !hb || now - hb > HEARTBEAT_STALE_SEC * 1000;

      if (bridgeDown) {
        show(`${olvIcon("warning")} برنامج الطباعة متوقف — الطلبات الجديدة ما رح تنطبع للمطبخ/البار (تأكد إن كمبيوتر الطباعة شغّال)`);
      } else if (stuck.length) {
        show(`${olvIcon("warning")} ${stuck.length} مهمة طباعة عالقة من أكتر من دقيقة — تأكد من الطابعات (ورق/شبكة/تشغيل)`);
      } else if (recentErrors.length) {
        show(`${olvIcon("warning")} فشلت طباعة ${recentErrors.length} مهمة مؤخرًا — الطلب ممكن ما وصل لقسم التحضير`);
      } else {
        hide();
      }
    } catch (e) { /* فحص إضافي فقط — تجاهل أي فشل */ }
  }

  function start() {
    check();
    setInterval(check, CHECK_MS);
  }

  return { start, check };
})();

document.addEventListener("DOMContentLoaded", () => OlvPrintHealth.start());
