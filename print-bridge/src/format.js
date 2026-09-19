function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

// numberingSystem: "latn" يفرض أرقام إنجليزية (0-9) بدل الأرقام الهندية
// العربية (٠-٩) على التذاكر المطبوعة، متل باقي شاشات النظام، مع إبقاء
// باقي تنسيق اللغة العربية (الفواصل وعلامة ص/م) كما هو
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("ar-EG", {
    hour: "2-digit", minute: "2-digit", numberingSystem: "latn",
  });
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("ar-EG", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    numberingSystem: "latn",
  });
}

module.exports = { formatMoney, formatTime, formatDateTime };
