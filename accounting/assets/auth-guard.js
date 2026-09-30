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
];
window.OLV_STAFF_PAGES = OLV_STAFF_PAGES;

// يتحقق من وجود جلسة دخول؛ وفي حال عدم وجودها يُعاد توجيه المستخدم إلى صفحة تسجيل الدخول
async function olvRequireAuth() {
  if (!window.supabaseClient) return null;
  const { data: { session } } = await window.supabaseClient.auth.getSession();
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

async function olvLogout() {
  if (window.supabaseClient) {
    await window.supabaseClient.auth.signOut();
  }
  window.location.href = "login.html";
}

// أدوات مساعدة عامة
function olvFormatMoney(n) {
  const v = Number(n || 0);
  // numberingSystem: "latn" يفرض أرقام إنجليزية (0-9) بدل الأرقام
  // الهندية العربية (٠-٩)، مع إبقاء باقي تنسيق اللغة العربية كما هو
  return v.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2, numberingSystem: "latn" });
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
