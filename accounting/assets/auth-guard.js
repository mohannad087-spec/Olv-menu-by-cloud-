// تحويل نص لـHTML آمن قبل ما ينحط جوّا innerHTML — أي نص كاتبه إنسان
// (اسم زبون، ملاحظة، رقم طاولة، وصف مصروف، طلب جاي من موقع المنيو...) لازم
// يمرّ من هون، وإلا كاشير أو زبون خبيث يقدر يزرع كود بصفحة المالك
function olvEsc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// الصفحات المسموحة للكاشير (role = staff) — الباقي (تقارير، إعدادات، رواتب،
// موظفين، مخزون، مشتريات، موردين...) للمالك والمدير بس. هاد لراحة الاستخدام؛
// الحماية الفعلية بـRLS والدوال بقاعدة البيانات (schema-cashier-hardening.sql)
const OLV_STAFF_PAGES = [
  "pos.html", "sales.html", "tables.html", "incoming-orders.html", "kitchen.html",
  "expenses.html", "cash-register.html", "customers.html", "attendance.html", "login.html",
  "recipes.html", // دليل تحضير المشروبات — مرجع ثابت للباريستا، ما فيه بيانات حساسة
];
window.OLV_STAFF_PAGES = OLV_STAFF_PAGES;

// يتحقق من وجود جلسة دخول؛ وفي حال عدم وجودها يُعاد توجيه المستخدم إلى صفحة تسجيل الدخول
async function olvRequireAuth() {
  if (!window.supabaseClient) return null;
  // الجلسة لازمها تجديد: إذا النت مقطوع منثبّتها مؤقتًا (بدل ما يعلّق كل شي 30 ثانية)،
  // وإذا كانت مثبّتة والنت رجع منجدّدها هلق
  const stored = typeof olvAuthHold === "function" ? olvStoredSessionWhileOffline() : null;
  if (stored && (localStorage.getItem(OLV_AUTH_HOLD_KEY) || stored.expires_at * 1000 - Date.now() < 5 * 60e3)) {
    const reachable = await olvProbeCloud();
    if (!reachable) olvAuthHold();
    else await olvAuthRelease();
  }
  let { data: { session } } = await window.supabaseClient.auth.getSession();
  // النت مقطوع والجلسة ما قدرت تتجدد: Supabase بيرجّع null، بس الجلسة لسا محفوظة عالجهاز
  // (بتنمسح بس عند الخروج أو إذا السيرفر رفضها). منكمّل فيها حتى ما ترجع شاشة الكاشير أو
  // المطبخ لصفحة الدخول وقت الانقطاع؛ أول ما يرجع النت بتتجدد لحالها
  if (!session) session = olvStoredSessionWhileOffline();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  // إيقاف حساب موظف (زر "إيقاف" بصفحة الموظفين) بيمنع تسجيل دخول/تجديد
  // جلسة جديد فورًا من عند Supabase، بس ما بيلغي جلسة مفتوحة أصلًا من
  // تلقاء نفسه — هاد الفحص هون بيسكّرها فعليًا من أول صفحة يفتحها بعدها
  const { data: profile } = await window.supabaseClient
    .from("profiles").select("is_active, role").eq("id", session.user.id).single();
  if (profile && profile.is_active === false) {
    await window.supabaseClient.auth.signOut();
    window.location.href = "login.html?deactivated=1";
    return null;
  }
  if (profile && profile.role) {
    window.olvRole = profile.role;
    const page = (window.location.pathname.split("/").pop() || "index.html");
    if (profile.role === "staff" && !OLV_STAFF_PAGES.includes(page)) {
      window.location.replace("pos.html");
      return null;
    }
  }
  return session;
}

// ---- تسجيل الدخول وقت انقطاع النت ----
// توكن الدخول بينتهي كل ساعة وبيتجدد من السيرفر. إذا النت مقطوع، مكتبة Supabase بتضل تحاول
// تجدّده قبل كل طلب (لحد 30 ثانية)، فالكاشير بيستنى كتير قبل ما ينحفظ البيع محليًا.
// الحل: وقت الانقطاع منأجّل موعد انتهاء الجلسة المحفوظة (التوكن نفسه ما بيتغيّر وما بيصير
// صالح أكتر عند السيرفر)، وأول ما يرجع النت منجدّدها فعليًا.
async function olvProbeCloud() {
  const cfg = window.OLV_ACCOUNTING_CONFIG || {};
  if (!cfg.SUPABASE_URL) return navigator.onLine;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(cfg.SUPABASE_URL, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: controller.signal });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// رجع النت: منجدّد الجلسة فعليًا. إذا السيرفر رفض التجديد (مش مشكلة نت) منرجّع الموعد الأصلي
// حتى المكتبة تتصرف عادي (تطلب تسجيل دخول)
async function olvAuthRelease() {
  if (typeof OLV_AUTH_HOLD_KEY === "undefined") return;
  let orig;
  try { orig = localStorage.getItem(OLV_AUTH_HOLD_KEY); } catch (_) { return; }
  if (!orig || !window.supabaseClient) return;
  const { error } = await window.supabaseClient.auth.refreshSession();
  if (error && olvIsNetworkError(error)) return; // لسا ما في نت فعليًا
  try {
    if (error) {
      const k = olvAuthStorageKey();
      const s = k && JSON.parse(localStorage.getItem(k) || "null");
      if (s) { s.expires_at = Number(orig); localStorage.setItem(k, JSON.stringify(s)); }
    }
    localStorage.removeItem(OLV_AUTH_HOLD_KEY);
  } catch (_) { /* ما في خزنة */ }
}

function olvStoredSessionWhileOffline() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!/^sb-.*-auth-token$/.test(k)) continue;
      const s = JSON.parse(localStorage.getItem(k) || "null");
      if (s && s.user && s.refresh_token) return s;
    }
  } catch (_) { /* ما في خزنة */ }
  return null;
}

async function olvLogout() {
  if (window.supabaseClient) {
    await window.supabaseClient.auth.signOut();
  }
  window.location.href = "login.html";
}

// رقم الفاتورة الدائم: ب-0001 للبيع، ش-0001 للشراء (schema-doc-numbers.sql)
function olvDocNo(kind, n) {
  if (n === null || n === undefined || n === "") return "";
  return (kind === "purchase" ? "ش" : "ب") + "-" + String(n).padStart(4, "0");
}

// رقم المورّد الدائم: م-001 (schema-supplier-no.sql)
function olvSupNo(n) {
  if (n === null || n === undefined || n === "") return "";
  return "م-" + String(n).padStart(3, "0");
}

// أدوات مساعدة عامة
function olvFormatMoney(n) {
  const v = Number(n || 0);
  // numberingSystem: "latn" يفرض أرقام إنجليزية (0-9) بدل الأرقام
  // الهندية العربية (٠-٩)، مع إبقاء باقي تنسيق اللغة العربية كما هو
  return v.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2, numberingSystem: "latn" });
}

// رقم الطاولة بشكل واحد: «٤» و«4» و« طاولة 4 » كلهم «4» — حتى الكاشير والمنيو وصفحة الطاولات
// يحكوا عن نفس الطاولة مهما انكتب
function olvNormTable(v) {
  return String(v == null ? "" : v)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/^\s*طاول[ةه]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function olvToday() {
  return new Date().toISOString().slice(0, 10);
}

// رسالة "Failed to fetch" الخام اللي بيرميها المتصفح لما ينقطع النت ما
// إلها معنى لكاشير — نستبدلها برسالة عربية واضحة تقول بالضبط شو صار
function olvIsNetworkError(err) {
  const msg = (err && err.message) ? err.message.toLowerCase() : "";
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed");
}

function olvShowError(el, err) {
  if (!el) return;
  console.error(err);
  if (olvIsNetworkError(err)) {
    el.textContent = "تعذّر الاتصال بالإنترنت — تأكد من الاتصال وحاول مرة ثانية. العملية لم تُسجَّل.";
  } else {
    el.textContent = (err && err.message) ? err.message : "حدث خطأ غير متوقع";
  }
  el.style.display = "block";
  if (typeof OlvSound !== "undefined") OlvSound.playError();
}
