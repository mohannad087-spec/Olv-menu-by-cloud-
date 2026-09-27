// "الحفظ المحلي وقت انقطاع الإنترنت": يعترض كل طلبات الكتابة (إضافة/
// تعديل/حذف/rpc) الموجّهة لقاعدة بيانات Supabase عبر fetch مخصَّص يُمرَّر
// لعميل Supabase (راجع supabase-client.js)، قبل ما توصل الشبكة فعليًا.
// لو فشل الطلب بسبب انقطاع حقيقي بالإنترنت (وليس رفض من السيرفر نفسه)،
// بدل ما تضيع العملية، تُخزَّن كاملة (الرابط، الترويسات، والمحتوى) بصندوق
// محلي بالمتصفح (localStorage)، ونرجّع للكود المستدعي استجابة ناجحة
// صوريّة فارغة — بالضبط متل نجاح حقيقي، لأن كل نداءات الكتابة بالبرنامج
// (راجع كل صفحات accounting/*.html) تتعامل فقط مع { error }، ولا تعتمد
// أبدًا على الصف المُرجَع من نداء الكتابة نفسه. أول ما يرجع الاتصال،
// تُعاد كل الطلبات المخزَّنة بنفس ترتيبها الأصلي تلقائيًا (flushQueue).
//
// لا نُخزّن أبدًا عمليات القراءة (select) — لا معنى لـ"إعادة تشغيلها"
// لاحقًا، وفشلها الطبيعي وقت الانقطاع معالج أصلًا برسالة الخطأ الموجودة
// (auth-guard.js: olvIsNetworkError).
(function () {
  const QUEUE_KEY = "olv_offline_queue_v1";
  const WRITE_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);
  let flushing = false;

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; }
  }

  function saveQueue(list) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch (e) { /* تجاهل (خزنة ممتلئة مثلاً) */ }
    window.dispatchEvent(new CustomEvent("olv-offline-queue-change", { detail: { count: list.length } }));
  }

  function isNetworkFailure(err) {
    const msg = (err && err.message) ? err.message.toLowerCase() : "";
    return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed");
  }

  function normalizeHeaders(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    return Object.assign({}, headers);
  }

  function enqueue(url, method, headers, body) {
    const list = loadQueue();
    list.push({
      id: "q-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      url: String(url), method, headers: normalizeHeaders(headers), body: body || null,
      queued_at: new Date().toISOString(),
    });
    saveQueue(list);
  }

  // استجابة صوريّة ناجحة فارغة — تكافئ Prefer: return=minimal (السلوك
  // الافتراضي لكل نداءات الكتابة بالبرنامج، راجع التعليق فوق)
  function fakeQueuedResponse() {
    return new Response("", { status: 201, headers: { "content-type": "application/json" } });
  }

  // الـfetch المخصَّص المُمرَّر لعميل Supabase (global.fetch) — شفّاف
  // بالكامل لأي طلب غير كتابة (قراءة، مصادقة...)، ويتدخّل فقط لما تفشل
  // كتابة فعلية على /rest/v1/ بسبب انقطاع شبكة حقيقي
  async function offlineAwareFetch(url, opts) {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const urlStr = String(url && url.url ? url.url : url);
    const isSupabaseWrite = WRITE_METHODS.has(method) && /\/rest\/v1\//.test(urlStr);
    try {
      return await fetch(url, opts);
    } catch (err) {
      if (isSupabaseWrite && isNetworkFailure(err)) {
        enqueue(urlStr, method, opts.headers, opts.body);
        return fakeQueuedResponse();
      }
      throw err;
    }
  }

  // يحاول تحديث توكن الجلسة (لو انتهت صلاحيته أثناء فترة انقطاع طويلة)
  // ويعيد كتابة ترويسة Authorization على كل الطلبات المخزَّنة بنفس
  // التوكن الجديد قبل إعادة إرسالها — بدون هذا، أي انقطاع أطول من صلاحية
  // الجلسة (ساعة افتراضيًا) بيخلي كل العمليات المحفوظة ترفض بـ401 للأبد
  async function refreshAuthHeader() {
    if (!window.supabaseClient) return null;
    const { data, error } = await window.supabaseClient.auth.refreshSession();
    if (error || !data || !data.session) return null;
    return data.session.access_token;
  }

  function rewriteQueuedAuth(list, newToken) {
    list.forEach((item) => {
      if (item.headers && item.headers.Authorization) {
        item.headers.Authorization = "Bearer " + newToken;
      }
      if (item.headers && item.headers.authorization) {
        item.headers.authorization = "Bearer " + newToken;
      }
    });
  }

  // يعيد إرسال كل الطلبات المخزَّنة بترتيبها الأصلي بالضبط (fetch مباشر،
  // بدون المرور بـofflineAwareFetch، حتى ما نعيد تخزينها من جديد لو
  // فشلت لنفس السبب). نتوقف عند أول عملية ما نجحت (شبكة لسا مقطوعة، أو
  // 401 وتعذّر تجديد الجلسة، أو أي رفض تاني من السيرفر) — أبدًا ما نحذف
  // عملية محفوظة بصمت، حتى لو فشلت أكتر من مرة، تفاديًا لضياع بيانات
  // مالية حقيقية (بيع، مصروف...) بدون علم صاحب المطعم
  async function flushQueue() {
    if (flushing) return;
    flushing = true;
    try {
      let list = loadQueue();
      while (list.length) {
        const item = list[0];
        let res;
        try {
          res = await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
        } catch (err) {
          break; // لسا ما في نت فعليًا — نتوقف ونعيد المحاولة لاحقًا
        }
        if (res.status === 401) {
          const newToken = await refreshAuthHeader();
          if (!newToken) break; // لازم تسجيل دخول من جديد لمزامنة المحفوظ
          rewriteQueuedAuth(list, newToken);
          saveQueue(list);
          continue; // نعيد نفس العنصر بالتوكن الجديد
        }
        if (!res.ok) {
          console.error("olv-offline-queue: تعذّرت مزامنة عملية محفوظة محليًا (سيُعاد المحاولة لاحقًا)", item, res.status);
          break;
        }
        list.shift();
        saveQueue(list);
      }
    } finally {
      flushing = false;
    }
  }

  window.olvOfflineFetch = offlineAwareFetch;
  window.olvFlushOfflineQueue = flushQueue;
  window.olvGetOfflineQueueCount = function () { return loadQueue().length; };

  window.addEventListener("online", flushQueue);
  window.dispatchEvent(new CustomEvent("olv-offline-queue-change", { detail: { count: loadQueue().length } }));
})();
