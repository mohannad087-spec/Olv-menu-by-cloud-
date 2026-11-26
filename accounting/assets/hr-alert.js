// تنبيه الرئيسية: موظفين عندهم إنذارين فأكتر خلال آخر 12 شهر (للمالك والمدير بس).
// الكاشير ما بيشوف جدول hr_records أصلاً (RLS)، فالنداء بيرجع فاضي وما بينعرض شي.
(function () {
  async function run() {
    const slot = document.getElementById("hr-alert-slot");
    if (!slot || !window.supabaseClient) return;
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) return;
      const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await window.supabaseClient.from("hr_records")
        .select("profile_id").eq("status", "active").like("kind", "warning_%").gt("record_date", from);
      if (error || !data || !data.length) return;
      const n = new Map();
      data.forEach((r) => n.set(r.profile_id, (n.get(r.profile_id) || 0) + 1));
      const hot = [...n.entries()].filter(([, c]) => c >= 2);
      if (!hot.length) return;
      const ids = hot.map(([id]) => id);
      const { data: ps } = await window.supabaseClient.from("profiles").select("id, full_name").in("id", ids);
      const nm = (id) => ((ps || []).find((p) => p.id === id) || {}).full_name || "موظف";
      const txt = hot.map(([id, c]) => `${olvEsc(nm(id))} (${c})`).join("، ");
      slot.innerHTML = `<a class="hr-home-alert" href="${hot.length === 1 ? "hr-profile.html?id=" + hot[0][0] : "hr.html"}">${olvIcon("warning")}<span><b>${hot.length === 1 ? "موظف" : hot.length + " موظفين"} عليهم إنذارات متكررة:</b> ${txt}</span></a>`;
    } catch (e) { /* التنبيه كمالي: لا نكسر الرئيسية */ }
  }
  document.addEventListener("DOMContentLoaded", () => setTimeout(run, 600));
})();
