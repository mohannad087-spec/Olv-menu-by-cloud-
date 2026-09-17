// يرسم شريط التنقل العلوي المشترك بين كل صفحات المحاسبة
function olvRenderNav(active) {
  const links = [
    { id: "dashboard", href: "index.html", label: "الرئيسية" },
    { id: "pos", href: "pos.html", label: "بيع سريع" },
    { id: "sales", href: "sales.html", label: "المبيعات" },
    { id: "incoming-orders", href: "incoming-orders.html", label: "الطلبات الواردة" },
    { id: "kitchen", href: "kitchen.html", label: "المطبخ" },
    { id: "inventory", href: "inventory.html", label: "المخزون" },
    { id: "expenses", href: "expenses.html", label: "المصروفات" },
    { id: "suppliers", href: "suppliers.html", label: "الموردون" },
    { id: "cash", href: "cash-register.html", label: "الخزينة" },
    { id: "reports", href: "reports.html", label: "التقارير" },
    { id: "settings", href: "settings.html", label: "الإعدادات" },
  ];
  const nav = document.getElementById("olv-nav");
  if (!nav) return;
  nav.innerHTML = `
    <div class="top">
      <h1>محاسبة OLV <span>لوحة تحكم المطعم</span></h1>
      <div class="actions">
        <button class="btn small" id="theme-toggle-btn"></button>
        <a class="btn small" href="https://olv-menu.pages.dev" target="_blank" rel="noopener">الموقع</a>
        <button class="btn small danger" id="olv-logout-btn">خروج</button>
      </div>
    </div>
    <div class="tabs">
      ${links
        .map(
          (l) =>
            `<a class="tab-link${l.id === active ? " on" : ""}" href="${l.href}">${l.label}</a>`
        )
        .join("")}
    </div>
  `;
  const logoutBtn = document.getElementById("olv-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", olvLogout);
  olvInitThemeToggle();
}

// يبني زر تبديل الإضاءة (تلقائي حسب الوقت / فاتح / داكن) في شريط التنقل
function olvThemeModeLabel(mode) {
  if (mode === "light") return "☀️ فاتح";
  if (mode === "dark") return "🌙 داكن";
  return "🌓 تلقائي";
}

function olvInitThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  const currentMode = localStorage.getItem("olv_theme_mode") || "auto";
  btn.textContent = olvThemeModeLabel(currentMode);
  btn.addEventListener("click", () => {
    const mode = localStorage.getItem("olv_theme_mode") || "auto";
    const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    localStorage.setItem("olv_theme_mode", next);
    if (window.olvApplyTheme) window.olvApplyTheme();
    btn.textContent = olvThemeModeLabel(next);
  });
}
