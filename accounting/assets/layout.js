// مجموعة أيقونات SVG بسيطة (نمط خطوط، بدون إيموجي) تُستخدم بشريط
// التنقل وأماكن تانية بالبرنامج — كل أيقونة مسارات فقط، تُغلَّف بـ
// olvIcon() بعنصر svg موحّد (viewBox 24x24) حتى تاخد نفس المقاس واللون
// (currentColor) تلقائيًا أينما استُخدمت
const OLV_ICON_PATHS = {
  brand: '<path d="M12 3c3 2.5 6 5.8 6 10a6 6 0 01-12 0c0-4.2 3-7.5 6-10z"/><path d="M12 9v9"/><path d="M12 12c-1.5-1.2-3-1-4 0"/>',
  home: '<path d="M4 11L12 4l8 7"/><path d="M6 10v9a1 1 0 001 1h4v-6h2v6h4a1 1 0 001-1v-9"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 9-11h-6l1-7z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
  flame: '<path d="M12 2c1 4-3 5-3 9a3 3 0 006 0c0-1-1-2-1-3 2 1 3 3 3 5a5 5 0 11-10 0c0-5 3-7 5-11z"/>',
  coffee: '<path d="M4 9h13v6a4 4 0 01-4 4H8a4 4 0 01-4-4V9z"/><path d="M17 10h1.5a2.5 2.5 0 010 5H17"/><path d="M8 2.5v2M12 2.5v2"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a1 1 0 001 1h12a1 1 0 001-1V8"/><path d="M10 12h4"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/><path d="M2 3h2l2.4 12.2a2 2 0 002 1.8h8.4a2 2 0 002-1.8L21 7H6"/><path d="M15 4v4M13 6h4"/>',
  minusCircle: '<circle cx="12" cy="12" r="9"/><path d="M7 12h10"/>',
  truck: '<rect x="1" y="7" width="13" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7v-6z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 12.5h3a.8.8 0 01.8.8v1.4a.8.8 0 01-.8.8h-3a1.5 1.5 0 010-3z"/><path d="M2 10h20"/>',
  barChart: '<path d="M6 20v-8M12 20V7M18 20v-5M3 20h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.2a1.7 1.7 0 00-1.6 1z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19v2.5M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19 12h2.5M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  moonAuto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 000 17z" style="fill:currentColor;stroke:none"/>',
  externalLink: '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h6"/>',
  logOut: '<path d="M9 21H5a1 1 0 01-1-1V4a1 1 0 011-1h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

function olvIcon(name, cls) {
  const inner = OLV_ICON_PATHS[name] || "";
  return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24">${inner}</svg>`;
}

// يرسم شريط التنقل العلوي المشترك بين كل صفحات المحاسبة
function olvRenderNav(active) {
  const links = [
    { id: "dashboard", href: "index.html", label: "الرئيسية", icon: "home" },
    { id: "pos", href: "pos.html", label: "بيع سريع", icon: "bolt" },
    { id: "sales", href: "sales.html", label: "المبيعات", icon: "receipt" },
    { id: "tables", href: "tables.html", label: "الطاولات", icon: "grid" },
    { id: "incoming-orders", href: "incoming-orders.html", label: "الطلبات الواردة", icon: "bell" },
    { id: "kitchen", href: "kitchen.html", label: "المطبخ", icon: "flame" },
    { id: "recipes", href: "recipes.html", label: "وصفات المشروبات", icon: "coffee" },
    { id: "inventory", href: "inventory.html", label: "المخزون", icon: "box" },
    { id: "supplies", href: "supplies.html", label: "المستلزمات", icon: "archive" },
    { id: "purchases", href: "purchases.html", label: "تسجيل شراء", icon: "cart" },
    { id: "expenses", href: "expenses.html", label: "المصروفات", icon: "minusCircle" },
    { id: "suppliers", href: "suppliers.html", label: "الموردون", icon: "truck" },
    { id: "cash", href: "cash-register.html", label: "الخزينة", icon: "wallet" },
    { id: "reports", href: "reports.html", label: "التقارير", icon: "barChart" },
    { id: "settings", href: "settings.html", label: "الإعدادات", icon: "gear" },
  ];
  const nav = document.getElementById("olv-nav");
  if (!nav) return;
  nav.innerHTML = `
    <div class="top">
      <h1 class="olv-brand">
        <span class="brand-mark-sm">${olvIcon("brand")}</span>
        <span class="brand-text">محاسبة OLV <span>لوحة تحكم المطعم</span></span>
      </h1>
      <div class="actions">
        <button class="btn small" id="theme-toggle-btn"></button>
        <a class="btn small" href="https://olv-menu.pages.dev" target="_blank" rel="noopener">${olvIcon("externalLink")} الموقع</a>
        <button class="btn small danger" id="olv-logout-btn">${olvIcon("logOut")} خروج</button>
      </div>
    </div>
    <div class="tabs">
      ${links
        .map(
          (l) =>
            `<a class="tab-link${l.id === active ? " on" : ""}" href="${l.href}">${olvIcon(l.icon)}<span>${l.label}</span></a>`
        )
        .join("")}
    </div>
  `;
  const logoutBtn = document.getElementById("olv-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", olvLogout);
  olvInitThemeToggle();
}

// يبني زر تبديل الإضاءة (تلقائي حسب الوقت / فاتح / داكن) في شريط التنقل
function olvThemeModeIcon(mode) {
  if (mode === "light") return olvIcon("sun");
  if (mode === "dark") return olvIcon("moon");
  return olvIcon("moonAuto");
}

function olvInitThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  const currentMode = localStorage.getItem("olv_theme_mode") || "auto";
  btn.innerHTML = olvThemeModeIcon(currentMode);
  btn.addEventListener("click", () => {
    const mode = localStorage.getItem("olv_theme_mode") || "auto";
    const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    localStorage.setItem("olv_theme_mode", next);
    if (window.olvApplyTheme) window.olvApplyTheme();
    btn.innerHTML = olvThemeModeIcon(next);
  });
}
