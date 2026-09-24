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

  // ---- دفعة ثانية: أيقونات محتوى الصفحات (بدل الإيموجي) ----
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4"/><path d="M8.5 12h7M8.5 15.5h7"/>',
  dineIn: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/>',
  mapPin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 105 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v.01M18 15v.01"/>',
  creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  warning: '<path d="M12 3.5L22 20H2L12 3.5z"/><path d="M12 10v4.5M12 17.2v.01" style="stroke-linecap:round"/>',
  link: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 115.6 5.6l-1 1"/><path d="M13 18l-1 1A4 4 0 016.4 13.4l1-1"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 006 6l1.5-2 4 1.5v3a2 2 0 01-2.2 2A17 17 0 014.5 5.7a2 2 0 012-2.2z"/>',
  refresh: '<path d="M4 12a8 8 0 0113.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  undo: '<path d="M7 8H3V4"/><path d="M3.5 13a8.5 8.5 0 1 0 2.4-8.4L3 8"/>',
  printer: '<path d="M6 8V3h12v5"/><rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M6 16v5h12v-5"/>',
  snowflake: '<path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/>',
  star: '<path d="M12 2.5l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.6-6.2 3.6 1.4-7L2 9.8l7-.8z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="8.5" y="2.5" width="7" height="3.5" rx="1"/><path d="M8.5 11h7M8.5 14.5h7"/>',
  tag: '<path d="M11.5 3H4v7.5L14 20.5 21 13.5 11.5 3z"/><circle cx="8" cy="7.5" r="1.3" style="fill:currentColor;stroke:none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  hourglass: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 4.5 3 6 5 7-2 1-5 2.5-5 7M17 3c0 4.5-3 6-5 7 2 1 5 2.5 5 7"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
};

function olvIcon(name, cls) {
  const inner = OLV_ICON_PATHS[name] || "";
  return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24">${inner}</svg>`;
}

// يرسم شريط التنقل العلوي المشترك بين كل صفحات المحاسبة — التبويبات
// اليومية عالية التكرار تضل ظاهرة مباشرة، والباقي مجمّع تحت "المزيد"
// بمجموعات منطقية، حتى ما يصير الشريط جدار عريض من 16 تبويب متراصين
function olvRenderNav(active) {
  const primaryLinks = [
    { id: "dashboard", href: "index.html", label: "الرئيسية", icon: "home" },
    { id: "pos", href: "pos.html", label: "بيع سريع", icon: "bolt" },
    { id: "sales", href: "sales.html", label: "المبيعات", icon: "receipt" },
    { id: "tables", href: "tables.html", label: "الطاولات", icon: "grid" },
    { id: "incoming-orders", href: "incoming-orders.html", label: "الطلبات الواردة", icon: "bell" },
    { id: "kitchen", href: "kitchen.html", label: "المطبخ", icon: "flame" },
  ];
  const moreGroups = [
    {
      label: "الجرد والمشتريات",
      links: [
        { id: "recipes", href: "recipes.html", label: "وصفات المشروبات", icon: "coffee" },
        { id: "inventory", href: "inventory.html", label: "المخزون", icon: "box" },
        { id: "supplies", href: "supplies.html", label: "المستلزمات", icon: "archive" },
        { id: "purchases", href: "purchases.html", label: "تسجيل شراء", icon: "cart" },
        { id: "suppliers", href: "suppliers.html", label: "الموردون", icon: "truck" },
      ],
    },
    {
      label: "الإدارة المالية",
      links: [
        { id: "expenses", href: "expenses.html", label: "المصروفات", icon: "minusCircle" },
        { id: "cash", href: "cash-register.html", label: "الخزينة", icon: "wallet" },
        { id: "reports", href: "reports.html", label: "التقارير", icon: "barChart" },
      ],
    },
    {
      label: "العملاء والإعدادات",
      links: [
        { id: "customers", href: "customers.html", label: "العملاء والولاء", icon: "star" },
        { id: "settings", href: "settings.html", label: "الإعدادات", icon: "gear" },
      ],
    },
  ];
  const moreActive = moreGroups.some((g) => g.links.some((l) => l.id === active));

  const tabLinkHtml = (l) =>
    `<a class="tab-link${l.id === active ? " on" : ""}" href="${l.href}">${olvIcon(l.icon)}<span>${l.label}</span></a>`;
  const moreLinkHtml = (l) =>
    `<a class="tab-link tab-more-link${l.id === active ? " on" : ""}" href="${l.href}">${olvIcon(l.icon)}<span>${l.label}</span></a>`;

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
      ${primaryLinks.map(tabLinkHtml).join("")}
      <div class="tab-more" id="olv-nav-more">
        <button type="button" class="tab-link tab-more-btn${moreActive ? " on" : ""}" id="olv-nav-more-btn">
          ${olvIcon("grid")}<span>المزيد</span>${olvIcon("chevronDown", "tab-more-chevron")}
        </button>
        <div class="tab-more-panel" id="olv-nav-more-panel">
          ${moreGroups
            .map(
              (g) => `
            <div class="tab-more-group">
              <div class="tab-more-group-label">${g.label}</div>
              ${g.links.map(moreLinkHtml).join("")}
            </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
  const logoutBtn = document.getElementById("olv-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", olvLogout);
  olvInitThemeToggle();
  olvInitMoreMenu();
}

// يتحكم بفتح/قفل قائمة "المزيد" المنسدلة — position:fixed عمدًا (بدل
// absolute) لأنها لو بقيت داخل .tabs (اللي عندها overflow-x:auto) رح
// تنقص/تتقص عند الفتح؛ fixed بيفلت من قصّ العنصر الأب تلقائيًا
function olvInitMoreMenu() {
  const wrap = document.getElementById("olv-nav-more");
  const btn = document.getElementById("olv-nav-more-btn");
  const panel = document.getElementById("olv-nav-more-panel");
  if (!wrap || !btn || !panel) return;

  function position() {
    const r = btn.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 260;
    panel.style.top = Math.round(r.bottom + 8) + "px";
    let right = window.innerWidth - r.right;
    right = Math.min(right, window.innerWidth - panelWidth - 12);
    right = Math.max(right, 12);
    panel.style.right = Math.round(right) + "px";
  }

  // ما في تسكير على scroll عمدًا: #olv-nav بره sticky بأعلى الشاشة دايمًا
  // (position:sticky top:0)، فزر "المزيد" ما بيتحرك أصلًا لما الصفحة
  // تتمرجل — وربط close() بـscroll سبب علة حقيقية: الضغطة نفسها على الزر
  // ممكن تحرّك تمرير شريط التبويبات الأفقي شوي (عشان الزر يضل ظاهر بالكامل)،
  // وهاد كان يقفل القائمة فور ما تنفتح
  function close() {
    wrap.classList.remove("open");
    document.removeEventListener("click", onOutsideClick);
    window.removeEventListener("resize", close);
  }

  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) close();
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    if (wrap.classList.contains("open")) { close(); return; }
    wrap.classList.add("open");
    position();
    document.addEventListener("click", onOutsideClick);
    window.addEventListener("resize", close);
  };

  // شارة تنبيه مجمّعة على زر "المزيد" — لو صنف بمخزون منخفض داخل القائمة
  // المطوية (مثلاً)، المستخدم لازم يشوف إشارة حتى بدون ما يفتحها
  function syncBadge() {
    btn.classList.toggle("has-badge", !!panel.querySelector(".tab-badge"));
  }
  syncBadge();
  new MutationObserver(syncBadge).observe(panel, { childList: true, subtree: true });
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
  // لما يكون في ثيم كامل مخصَّص فعّال، زر تبديل الفاتح/الداكن ما إله معنى
  // (الثيم المخصَّص بيغطي كل الألوان بغض النظر عن data-theme) — نخفيه بدل
  // ما يظهر وكأنه شغال وهو مش مؤثر فعليًا
  if (window.olvCustomThemeActive) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  const currentMode = localStorage.getItem("olv_theme_mode") || "auto";
  btn.innerHTML = olvThemeModeIcon(currentMode);
  // onclick بدل addEventListener عمدًا: الدالة هاي ممكن تُستدعى أكثر من
  // مرة بنفس تحميل الصفحة (بعد حفظ/استعادة الثيم المخصَّص من الإعدادات)،
  // وonclick بيستبدل المعالج السابق بدل ما يراكم معالجات مكرَّرة فوق بعض
  btn.onclick = () => {
    const mode = localStorage.getItem("olv_theme_mode") || "auto";
    const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    localStorage.setItem("olv_theme_mode", next);
    if (window.olvApplyTheme) window.olvApplyTheme();
    btn.innerHTML = olvThemeModeIcon(next);
  };
}

// ================= تخصيص ثيم كامل للبرنامج (خلفية + لون علامة) =================
// المستخدم بيختار لونين بس: لون الخلفية الأساسي ولون العلامة/الأزرار،
// وهاي الدوال بتشتق منهم كل الألوان التانية (خلفيات البطاقات، النص،
// النص الخافت، الحدود، ودرجات لون العلامة الفاتحة/الغامقة) عبر HSL —
// ثيم ثابت واحد بيستبدل تبديل الفاتح/الداكن التلقائي بالكامل، تمامًا متل
// موقع مرجعي بلونين محددين (خلفية + تمييز) بدون تبديل أوضاع
const OLV_THEME_KEY = "olv_custom_theme";

function olvHexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function olvRgbToHex(r, g, b) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function olvRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function olvHslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// يولّد نسخة أفتح/أغمق من لون أساسي عبر تعديل الإضاءة (L) والتشبع (S) في
// فضاء HSL، مع حدود دنيا/قصوى واسعة (2–98) تمنع وصول اللون لأسود/أبيض
// خالص بس بدون ما "تعكس" اتجاه الفرق المطلوب — حد أضيق متل 8–92 كان
// عمليًا بيرجّع لون أساسي قريب من الأبيض (خلفية فاتحة جدًا) أغمق من
// الأصل رغم إن lDelta موجب، لأن القيمة الأصلية كانت أعلى من سقف الحد
function olvShadeHex(baseHex, lDelta, sDelta) {
  const rgb = olvHexToRgb(baseHex);
  if (!rgb) return baseHex;
  const hsl = olvRgbToHsl(rgb.r, rgb.g, rgb.b);
  const l = Math.max(2, Math.min(98, hsl.l + lDelta));
  const s = Math.max(0, Math.min(100, hsl.s + sDelta));
  const out = olvHslToRgb(hsl.h, s, l);
  return olvRgbToHex(out.r, out.g, out.b);
}

function olvContrastTextColor(baseHex, lightColor, darkColor) {
  const rgb = olvHexToRgb(baseHex);
  if (!rgb) return darkColor || "#100e08";
  const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return yiq >= 140 ? (darkColor || "#100e08") : (lightColor || "#faf7f0");
}

// يبني كامل ثيم البرنامج (خلفيات، نصوص، حدود، درجات لون العلامة) من لونين
// بس يختارهم المستخدم: لون الخلفية الأساسي ولون العلامة/الأزرار. يكتشف
// تلقائيًا إذا الخلفية غامقة أو فاتحة (عبر إضاءة HSL) ويشتق باقي الدرجات
// بنفس اتجاه التدرّج المناسب لكل حالة
function olvComputeCustomTheme(bgHex, accentHex) {
  const bgRgb = olvHexToRgb(bgHex);
  const accentRgb = olvHexToRgb(accentHex);
  if (!bgRgb || !accentRgb) return null;
  const bgHsl = olvRgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);
  const isDark = bgHsl.l < 50;
  const bgRgbStr = `${Math.round(bgRgb.r)},${Math.round(bgRgb.g)},${Math.round(bgRgb.b)}`;
  const accentRgbStr = `${Math.round(accentRgb.r)},${Math.round(accentRgb.g)},${Math.round(accentRgb.b)}`;

  const ink = bgHex;
  const ink2 = isDark ? olvShadeHex(bgHex, 5, 2) : olvShadeHex(bgHex, 6, 0);
  const ink3 = isDark ? olvShadeHex(bgHex, 10, 3) : olvShadeHex(bgHex, -6, 5);
  const textRgb = isDark
    ? olvHslToRgb(bgHsl.h, Math.min(25, bgHsl.s * 0.3), 90)
    : olvHslToRgb(bgHsl.h, Math.min(45, bgHsl.s * 0.5 + 10), 12);
  const mutedRgb = isDark
    ? olvHslToRgb(bgHsl.h, Math.min(25, bgHsl.s * 0.3), 60)
    : olvHslToRgb(bgHsl.h, Math.min(35, bgHsl.s * 0.4), 32);
  const paper = olvRgbToHex(textRgb.r, textRgb.g, textRgb.b);
  const muted = olvRgbToHex(mutedRgb.r, mutedRgb.g, mutedRgb.b);

  const goldHi = isDark ? olvShadeHex(accentHex, 26, 15) : olvShadeHex(accentHex, -16, 27);
  const goldDp = isDark ? olvShadeHex(accentHex, -23, 17) : olvShadeHex(accentHex, -26, 24);
  const onGold = olvContrastTextColor(accentHex);

  return {
    isDark,
    ink, ink2, ink3, paper, muted,
    hair: `rgba(${accentRgbStr},.25)`,
    hairSoft: `rgba(${accentRgbStr},.1)`,
    overlayBg: `rgba(${bgRgbStr},.94)`,
    gold: accentHex, goldHi, goldDp, goldRgb: accentRgbStr, onGold,
  };
}

function olvSaveCustomTheme(bgHex, accentHex) {
  const theme = olvComputeCustomTheme(bgHex, accentHex);
  if (!theme) return false;
  localStorage.setItem(OLV_THEME_KEY, JSON.stringify(theme));
  if (window.olvApplyTheme) window.olvApplyTheme();
  return true;
}

function olvResetCustomTheme() {
  localStorage.removeItem(OLV_THEME_KEY);
  if (window.olvApplyTheme) window.olvApplyTheme();
}

// يرجّع لوني الخلفية/العلامة الأساسيين المخزَّنين حاليًا (لتعبئة حقول
// اختيار اللون بصفحة الإعدادات)، أو null لو ما في ثيم مخصَّص محفوظ
function olvGetCustomThemeColors() {
  try {
    const raw = localStorage.getItem(OLV_THEME_KEY);
    if (!raw) return null;
    const theme = JSON.parse(raw);
    if (!theme || !theme.ink || !theme.gold) return null;
    return { bg: theme.ink, accent: theme.gold };
  } catch (e) {
    return null;
  }
}
