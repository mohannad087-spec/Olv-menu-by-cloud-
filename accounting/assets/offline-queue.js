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
  const FAILED_KEY = "olv_offline_failed_v1";
  const WRITE_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);
  let flushing = false;

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; }
  }

  function saveQueue(list) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch (e) { /* تجاهل (خزنة ممتلئة مثلاً) */ }
    window.dispatchEvent(new CustomEvent("olv-offline-queue-change", { detail: { count: list.length } }));
  }

  function loadFailed() {
    try { return JSON.parse(localStorage.getItem(FAILED_KEY) || "[]"); } catch (e) { return []; }
  }

  function saveFailed(list) {
    try { localStorage.setItem(FAILED_KEY, JSON.stringify(list)); } catch (e) { /* تجاهل */ }
    window.dispatchEvent(new CustomEvent("olv-offline-queue-change", { detail: { count: loadQueue().length } }));
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
  // انقطاع معروف: آخر فشل شبكة صار من شوي. مكتبة Supabase بتعيد كل قراءة فاشلة 3 مرات
  // بفواصل (حوالي 7 ثواني للقراءة الوحدة)، فوقت الانقطاع المعروف منرجّع الفشل فورًا باسم
  // AbortError (المكتبة ما بتعيد المحاولة عليه) حتى الصفحات ما تعلّق
  let lastNetFail = window.OLV_LOCAL_OFFLINE ? Date.now() : 0;
  const knownOffline = () => Date.now() - lastNetFail < 20000;
  function fastFail(err) {
    const e = new Error((err && err.message) || "Failed to fetch");
    e.name = "AbortError";
    return e;
  }

  // مهلة الطلبات: بدونها، لما الراوتر شغال والنت مقطوع، المتصفح بيستنى نص دقيقة أو أكتر قبل ما يفشل،
  // والكاشير بيشوف الدفع «معلّق». البيع نفسه مهلته قصيرة لأن تكراره آمن (client_ref بيمنع البيع المزدوج)
  const SALE_TIMEOUT_MS = 6000;
  const WRITE_TIMEOUT_MS = 10000;
  const READ_TIMEOUT_MS = 8000;
  const isRestUrl = (u) => /\/(rest|auth)\/v1\//.test(u) || /\/functions\/v1\//.test(u);

  // بيع فيه client_ref: السيرفر بيتجاهل التكرار، فآمن نخزّنه ونعيد إرساله حتى لو الطلب الأول وصل فعلًا
  function isIdempotentSale(urlStr, body) {
    return /\/rpc\/record_sale/.test(urlStr) && typeof body === "string" && body.indexOf("p_client_ref") !== -1;
  }

  async function offlineAwareFetch(url, opts) {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const urlStr = String(url && url.url ? url.url : url);
    // إعادة الطباعة ما بتنحفظ أوفلاين: لازم تفشل بوضوح، مش تنطبع فجأة بعد ساعات
    const isSupabaseWrite = WRITE_METHODS.has(method) && /\/rest\/v1\//.test(urlStr)
      && !/\/rpc\/reprint_receipt/.test(urlStr);
    // النت مقطوع ومعروف (الفحص الدوري أو فشل قريب): ما منحاول نوصل أصلًا — البيع بينحفظ محليًا فورًا
    if (knownOffline() && isRestUrl(urlStr)) {
      if (isSupabaseWrite) {
        enqueue(urlStr, method, opts.headers, opts.body);
        return fakeQueuedResponse();
      }
      throw fastFail();
    }
    const sale = isIdempotentSale(urlStr, opts.body);
    const ms = !isRestUrl(urlStr) ? 0 : sale ? SALE_TIMEOUT_MS : isSupabaseWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
    const ctl = ms && typeof AbortController !== "undefined" ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    let callOpts = opts;
    if (ctl) {
      timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
      if (opts.signal) {
        if (opts.signal.aborted) ctl.abort();
        else opts.signal.addEventListener("abort", () => ctl.abort(), { once: true });
      }
      callOpts = Object.assign({}, opts, { signal: ctl.signal });
    }
    try {
      const res = await fetch(url, callOpts);
      lastNetFail = 0;
      return res;
    } catch (err) {
      if (!timedOut && !isNetworkFailure(err)) throw err;
      lastNetFail = Date.now();
      if (isSupabaseWrite && (!timedOut || sale)) {
        enqueue(urlStr, method, opts.headers, opts.body);
        return fakeQueuedResponse();
      }
      // انتهت المهلة لعملية مش آمنة نكررها (ممكن وصلت فعلًا): منفشلها بوضوح بدل ما نخزّنها ونكررها
      if (timedOut) throw fastFail(new Error("Failed to fetch (timeout)"));
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
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
          // مشكلة مؤقتة بالسيرفر: منستنى ومنعيد المحاولة لاحقًا
          if (res.status >= 500 || res.status === 408 || res.status === 429) {
            console.error("olv-offline-queue: تعذّرت مزامنة عملية محفوظة محليًا (سيُعاد المحاولة لاحقًا)", item, res.status);
            break;
          }
          // السيرفر رفض العملية نفسها (مثلًا خصم أكبر من المسموح، صنف انحذف): ما منحذفها بصمت ولا
          // منخليها توقف كل اللي بعدها — بتنتقل لقائمة «مرفوضة» بتظهر للمستخدم يقرر فيها
          const text = await res.text().catch(() => "");
          let reason = text;
          try { const j = JSON.parse(text); reason = j.message || j.hint || text; } catch (e) { /* نص عادي */ }
          const failed = loadFailed();
          failed.push(Object.assign({}, item, { failed_at: new Date().toISOString(), status: res.status, reason: String(reason).slice(0, 300) }));
          saveFailed(failed);
          list.shift();
          saveQueue(list);
          continue;
        }
        list.shift();
        saveQueue(list);
      }
    } finally {
      flushing = false;
    }
  }

  window.olvOfflineFetch = offlineAwareFetch;
  window.olvMarkOffline = () => { lastNetFail = Date.now(); };
  window.olvMarkOnline = () => { lastNetFail = 0; };
  window.olvFlushOfflineQueue = flushQueue;
  window.olvGetOfflineQueueCount = function () { return loadQueue().length; };
  // العمليات اللي رفضها السيرفر بعد رجوع النت (بتعرضها connection-status.js)
  window.olvGetOfflineFailed = loadFailed;
  // إعادة محاولة: بترجع لآخر الصف وبتنرفع من جديد (بتنفع لو السبب انحل، مثلًا مدير وافق على الخصم)
  window.olvRetryOfflineFailed = function (id) {
    const failed = loadFailed();
    const i = failed.findIndex((x) => x.id === id);
    if (i < 0) return;
    const item = failed.splice(i, 1)[0];
    ["failed_at", "status", "reason"].forEach((k) => delete item[k]);
    saveFailed(failed);
    const list = loadQueue();
    list.push(item);
    saveQueue(list);
    flushQueue();
  };
  window.olvDiscardOfflineFailed = function (id) {
    saveFailed(loadFailed().filter((x) => x.id !== id));
  };

  window.addEventListener("online", flushQueue);
  window.dispatchEvent(new CustomEvent("olv-offline-queue-change", { detail: { count: loadQueue().length } }));
})();
