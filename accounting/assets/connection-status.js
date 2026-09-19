// بانر تحذيري ثابت يظهر أعلى أي صفحة لما ينقطع الإنترنت، ويختفي مع
// تأكيد قصير لما يرجع. الاعتماد بشكل أساسي على أحداث online/offline
// المدعومة بكل المتصفحات — كافية للحالة الأشيع (واي فاي/بيانات انقطعت
// فعليًا)، وما بتحتاج أي طلب شبكة إضافي بنفسها
(function () {
  function ensureBanner() {
    let el = document.getElementById("olv-connection-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "olv-connection-banner";
      el.className = "olv-connection-banner";
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function showOffline() {
    const el = ensureBanner();
    el.textContent = "⚠️ لا يوجد اتصال بالإنترنت — أي عملية جديدة (بيع، حفظ...) لن تُسجَّل لحد ما يرجع الاتصال";
    el.className = "olv-connection-banner show offline";
  }

  function showBackOnline() {
    const el = ensureBanner();
    el.textContent = "✓ رجع الاتصال بالإنترنت";
    el.className = "olv-connection-banner show online";
    setTimeout(() => { el.classList.remove("show"); }, 2500);
  }

  window.addEventListener("offline", showOffline);
  window.addEventListener("online", showBackOnline);
  if (navigator.onLine === false) showOffline();
})();
