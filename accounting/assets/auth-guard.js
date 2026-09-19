// يتحقق من وجود جلسة دخول؛ وفي حال عدم وجودها يُعاد توجيه المستخدم إلى صفحة تسجيل الدخول
async function olvRequireAuth() {
  if (!window.supabaseClient) return null;
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
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

function olvShowError(el, err) {
  if (!el) return;
  console.error(err);
  el.textContent = (err && err.message) ? err.message : "حدث خطأ غير متوقع";
  el.style.display = "block";
  if (typeof OlvSound !== "undefined") OlvSound.playError();
}
