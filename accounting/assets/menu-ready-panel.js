// لوحة عائمة صغيرة (شاشة البيع + الطلبات الواردة) لطلبات المنيو اللي انقبلت:
//   جاهزة       = كل أقسام المطبخ/البار خلّصت. الزبون بينبلّغ تلقائيًا (بتطلعله صفحة «طلبك جاهز» برقمه ومكان الاستلام)
//                 بدون ما حدا يكبس إشي؛ زر «أبلّغ الزبون» بيضل احتياط لو التبليغ التلقائي فشل.
// على شاشة المطبخ السكربت بيشتغل بدون واجهة (data-headless): أول ما يخلص الطلب هناك بينبلّغ الزبون بلحظتها.
//   تم إبلاغ الزبون = الحالة صارت «ready» بموقع المنيو؛ زر «تسليم» بيسكّر الطلب.
//   قيد التحضير = لسا في أصناف ما خلصت («باقي N من M»).
// بتعتمد على OlvIncomingPoll (نفس فحص الطلبات الواردة) وعلى sales_entries.client_ref اللي بيربط الطلب بالبيع المسجّل عند القبول.
// ما بتظهر أبدًا إذا ما في طلبات منيو نشطة، وبتنطوي لزر صغير (الحالة بتنحفظ على الجهاز).
(function () {
  if (window.OlvMenuReady) return;
  const HEADLESS = !!(document.currentScript && document.currentScript.hasAttribute("data-headless"));

  const REMEMBER_KEY = "olv-mrp-open";
  const DEFAULT_PICKUP = "استلم طلبك من الكاشير";

  // UUID ثابت مشتق من رقم الطلب: نفس المرجع اللي بنسجّل فيه البيع عند القبول (incoming-orders.html)
  async function orderRef(id) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("olv-online-order:" + id)));
    const h = Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  window.olvMenuOrderRef = orderRef;

  const esc = (s) => (typeof olvEsc === "function" ? olvEsc(s) : String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])));
  const icon = (n) => (typeof olvIcon === "function" ? olvIcon(n) : "");

  let root = null;
  let open = false;
  try { open = localStorage.getItem(REMEMBER_KEY) === "1"; } catch (e) {}
  let model = { ready: [], notified: [], prep: [] };
  let knownReady = null; // null = لسا ما انعمل الأساس الأول، حتى ما نرنّ على طلبات جاهزة أصلًا لما تنفتح الصفحة
  let lastOrders = [];
  let pickupText = DEFAULT_PICKUP;
  let busy = false, again = false, refreshTimer = null;
  const autoTried = new Map(); // رقم الطلب => وقت آخر محاولة تبليغ تلقائي (حتى ما نكرر كل فحص)

  const STYLE = `
  #mrp{position:fixed; z-index:44; inset-inline-end:auto; left:14px; bottom:16px; width:min(340px, calc(100vw - 28px)); direction:rtl; font-family:inherit; display:none; pointer-events:none;}
  #mrp > *{pointer-events:auto;}
  #mrp.has{display:block;}
  @media (max-width:900px){#mrp{bottom:calc(var(--bnav-h, 0px) + 86px); left:10px;}}
  #mrp .mrp-pill{display:flex; width:max-content; margin-right:auto; align-items:center; gap:8px; min-height:46px; padding:6px 14px 6px 10px; border:1px solid var(--glass-line, var(--hair)); border-radius:999px; background:var(--glass, var(--ink-2)); color:var(--paper); -webkit-backdrop-filter:blur(18px) saturate(170%); backdrop-filter:blur(18px) saturate(170%); box-shadow:0 10px 26px -14px rgba(47,36,22,.6); font:700 13.5px/1 inherit; cursor:pointer;}
  #mrp .mrp-pill .icon{width:20px; height:20px;}
  #mrp .mrp-n{min-width:24px; height:24px; padding:0 7px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; font-variant-numeric:tabular-nums;}
  #mrp .mrp-n.ready{background:var(--olive); color:var(--on-olive);}
  #mrp .mrp-n.prep{background:var(--ink-3); color:var(--paper);}
  #mrp.pulse .mrp-pill{animation:mrp-pulse 1.6s ease-out infinite;}
  @keyframes mrp-pulse{0%{box-shadow:0 0 0 0 rgba(var(--olive-rgb,86,105,46),.55), 0 10px 26px -14px rgba(47,36,22,.6);}100%{box-shadow:0 0 0 14px rgba(var(--olive-rgb,86,105,46),0), 0 10px 26px -14px rgba(47,36,22,.6);}}
  #mrp .mrp-card{display:none; margin-bottom:8px; border:1px solid var(--hair); border-radius:20px; background:var(--ink-2); color:var(--paper); box-shadow:0 18px 40px -18px rgba(47,36,22,.6); overflow:hidden;}
  #mrp.open .mrp-card{display:block; animation:mrp-in .22s var(--spring, ease) both;}
  @keyframes mrp-in{from{opacity:0; transform:translateY(10px) scale(.98);}}
  #mrp .mrp-body{max-height:min(52vh, 420px); overflow:auto; padding:6px 10px 10px; overscroll-behavior:contain;}
  #mrp .mrp-h{display:flex; align-items:center; gap:6px; margin:10px 2px 6px; font-size:12.5px; font-weight:800; color:var(--muted);}
  #mrp .mrp-h .icon{width:15px; height:15px;}
  #mrp .mrp-row{display:flex; align-items:center; gap:10px; padding:9px 10px; margin-bottom:6px; border:1px solid var(--hair-soft, var(--hair)); border-radius:14px; background:var(--ink);}
  #mrp .mrp-row.ready{border-color:var(--olive); background:rgba(var(--olive-rgb,86,105,46),.1);}
  #mrp .mrp-info{flex:1; min-width:0;}
  #mrp .mrp-no{font-size:17px; font-weight:800; font-variant-numeric:tabular-nums;}
  #mrp .mrp-sub{font-size:12.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  #mrp .mrp-btn{min-height:44px; padding:0 14px; border:0; border-radius:12px; background:var(--olive); color:var(--on-olive); font:800 13.5px inherit; cursor:pointer; white-space:nowrap; transition:transform .08s;}
  #mrp .mrp-btn:active{transform:scale(.96);}
  #mrp .mrp-btn.soft{background:var(--ink-3); color:var(--paper);}
  #mrp a.mrp-btn{display:inline-flex; align-items:center; gap:4px; text-decoration:none;}
  #mrp .mrp-wa{padding:0 10px; margin-inline-end:-4px;}
  #mrp .mrp-btn:disabled{opacity:.55; cursor:default;}
  #mrp .mrp-bar{height:5px; border-radius:99px; background:var(--ink-3); margin-top:6px; overflow:hidden;}
  #mrp .mrp-bar i{display:block; height:100%; background:var(--gold); border-radius:99px;}
  #mrp .mrp-empty{padding:14px; text-align:center; color:var(--muted); font-size:13px;}
  @media (prefers-reduced-motion:reduce){#mrp.pulse .mrp-pill, #mrp.open .mrp-card{animation:none;}}
  `;

  function modeText(o) {
    if (o.mode === "hall") return o.table ? "طاولة " + o.table : "صالة";
    return o.mode === "delivery" ? "توصيل" : "سفري";
  }

  function minutesSince(iso) {
    const t = iso ? new Date(iso).getTime() : 0;
    if (!t) return "";
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? "هلأ" : "من " + m + " د";
  }

  function ensureRoot() {
    if (root || HEADLESS) return root;
    const st = document.createElement("style");
    st.textContent = STYLE;
    document.head.appendChild(st);
    root = document.createElement("div");
    root.id = "mrp";
    root.setAttribute("aria-live", "polite");
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    return root;
  }

  // رابط واتساب مجاني (wa.me): بيفتح محادثة الزبون برسالة جاهزة، والكاشير بس بيكبس «إرسال»
  function waLink(o) {
    let d = String(o.phone || "").replace(/[^\d]/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "962" + d.slice(1);
    else if (d.length === 9 && d.startsWith("7")) d = "962" + d;
    if (d.length < 10) return "";
    const where = o.mode === "hall" ? "رح نوصله لطاولتك" + (o.table ? " رقم " + o.table : "")
      : o.mode === "delivery" ? "وهو بطريقه إلك" : pickupText;
    const text = "OLV: طلبك رقم #" + o.number + " جاهز ✅\n" + where;
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(text);
  }

  function rowHtml(o, kind) {
    const sale = o._sale;
    let sub = esc(modeText(o)) + " · " + esc(typeof olvFormatMoney === "function" ? olvFormatMoney(o.total) : o.total);
    let extra = "", btn = "";
    if (kind === "ready") {
      sub = esc(modeText(o)) + " · جاهز " + esc(minutesSince(sale && sale.kitchen_ready_at));
      btn = `<button class="mrp-btn" data-notify="${esc(o.id)}">${icon("bell")} أبلّغ الزبون</button>`;
    } else if (kind === "notified") {
      sub = esc(modeText(o)) + " · الزبون انبلّغ";
      btn = `<button class="mrp-btn soft" data-done="${esc(o.id)}">${icon("checkCircle")} تسليم</button>`;
    } else if (o._left != null) {
      const done = o._total - o._left;
      sub = esc(modeText(o)) + " · باقي " + o._left + " من " + o._total;
      extra = `<div class="mrp-bar"><i style="width:${o._total ? Math.round((done / o._total) * 100) : 0}%"></i></div>`;
    }
    const wa = (kind === "ready" || kind === "notified") ? waLink(o) : "";
    if (wa) btn = `<a class="mrp-btn soft mrp-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="بلّغه على واتساب">${icon("phone")} واتساب</a>` + btn;
    return `<div class="mrp-row${kind === "ready" ? " ready" : ""}">
      <div class="mrp-info"><div class="mrp-no">#${esc(o.number)}</div><div class="mrp-sub">${sub}</div>${extra}</div>${btn}</div>`;
  }

  function render() {
    if (HEADLESS) return;
    const r = ensureRoot();
    const { ready, notified, prep } = model;
    const total = ready.length + notified.length + prep.length;
    r.classList.toggle("has", total > 0);
    r.classList.toggle("pulse", ready.length > 0);
    r.classList.toggle("open", open && total > 0);
    const sec = (ic, title, arr, kind) => arr.length ? `<div class="mrp-h">${icon(ic)} ${title} (${arr.length})</div>${arr.map((o) => rowHtml(o, kind)).join("")}` : "";
    r.innerHTML = `
      <div class="mrp-card" role="dialog" aria-label="طلبات المنيو">
        <div class="mrp-body">
          ${sec("bell", "جاهزة — بلّغ الزبون", ready, "ready")}
          ${sec("checkCircle", "انبلّغ الزبون", notified, "notified")}
          ${sec("clock", "قيد التحضير", prep, "prep")}
          ${total ? "" : '<div class="mrp-empty">ما في طلبات منيو نشطة</div>'}
        </div>
      </div>
      <button class="mrp-pill" data-toggle aria-expanded="${open && total > 0}" aria-label="طلبات المنيو">
        ${icon("bell")} <span>المنيو</span>
        <span class="mrp-n ready" title="جاهزة">${ready.length}</span>
        <span class="mrp-n prep" title="قيد التحضير">${prep.length}</span>
      </button>`;
  }

  async function onClick(e) {
    if (e.target.closest("[data-toggle]")) {
      open = !open;
      try { localStorage.setItem(REMEMBER_KEY, open ? "1" : "0"); } catch (err) {}
      render();
      return;
    }
    const nb = e.target.closest("[data-notify]");
    const db = e.target.closest("[data-done]");
    const btn = nb || db;
    if (!btn) return;
    const id = btn.dataset.notify || btn.dataset.done;
    const o = lastOrders.find((x) => x.id === id);
    if (!o) return;
    btn.disabled = true;
    try {
      if (nb) {
        await sendReady(o);
        if (typeof olvToast === "function") olvToast("انبعتت للزبون: طلبك #" + o.number + " جاهز", { type: "info" });
      } else {
        await OlvIncomingPoll.callProxy({ action: "update", id, status: "completed" });
      }
      await OlvIncomingPoll.pollNow();
    } catch (err) {
      if (typeof olvToast === "function") olvToast(err.message || "تعذر التحديث", { type: "danger" });
      btn.disabled = false;
    }
  }

  function sendReady(o) {
    const payload = { action: "update", id: o.id, status: "ready" };
    // مكان الاستلام بينكتب بالإعدادات للسفري. الصالة والتوصيل الصفحة عند الزبون بتختار الجملة المناسبة
    if (o.mode !== "hall" && o.mode !== "delivery") payload.pickup = pickupText;
    return OlvIncomingPoll.callProxy(payload);
  }

  // كل طلب خلص بالمطبخ بينبلّغ زبونه لحاله. لو فشل (نت مثلًا) بنعيد بعد دقيقة، والزر اليدوي موجود
  async function autoNotify(list) {
    // نستنى نص مكان الاستلام من الإعدادات (لحد 3 ثواني) قبل أول تبليغ
    await Promise.race([pickupLoaded, new Promise((r) => setTimeout(r, 3000))]);
    let sent = false;
    for (const o of list) {
      const last = autoTried.get(o.id);
      if (last && Date.now() - last < 60000) continue;
      autoTried.set(o.id, Date.now());
      try {
        await sendReady(o);
        sent = true;
        if (!HEADLESS && typeof olvToast === "function") olvToast("طلب المنيو #" + o.number + " جاهز، وانبلّغ الزبون", { type: "info" });
      } catch (e) { /* بيضل بقائمة «جاهزة» مع زر يدوي */ }
    }
    if (sent) OlvIncomingPoll.pollNow();
  }

  let pickupLoaded = Promise.resolve();
  async function loadPickup() {
    try {
      const { data } = await window.supabaseClient.from("app_settings").select("value").eq("key", "menu_pickup_text").maybeSingle();
      if (data && String(data.value || "").trim()) pickupText = String(data.value).trim().slice(0, 120);
    } catch (e) {}
  }

  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const active = lastOrders.filter((o) => o.status === "preparing" || o.status === "ready");
      const next = { ready: [], notified: [], prep: [] };
      let sales = new Map();
      const toCheck = active.filter((o) => o.status === "preparing");
      if (toCheck.length && window.supabaseClient) {
        const refs = await Promise.all(toCheck.map(async (o) => [await orderRef(o.id), o]));
        const { data: rows } = await window.supabaseClient
          .from("sales_entries").select("id, client_ref, status, kitchen_status, kitchen_ready_at")
          .in("client_ref", refs.map((x) => x[0]));
        const byRef = new Map((rows || []).map((s) => [s.client_ref, s]));
        refs.forEach(([ref, o]) => { const s = byRef.get(ref); if (s) sales.set(o.id, s); });
        const ids = [...sales.values()].filter((s) => s.kitchen_status !== "جاهز").map((s) => s.id);
        if (ids.length) {
          const { data: items } = await window.supabaseClient
            .from("sale_items").select("sale_id, status, kitchen_done_at").in("sale_id", ids);
          const cnt = new Map();
          (items || []).forEach((it) => {
            if (it.status === "voided") return;
            const c = cnt.get(it.sale_id) || { t: 0, l: 0 };
            c.t++; if (!it.kitchen_done_at) c.l++;
            cnt.set(it.sale_id, c);
          });
          sales.forEach((s, oid) => { const c = cnt.get(s.id); if (c) { s._total = c.t; s._left = c.l; } });
        }
      }
      active.forEach((o) => {
        const s = sales.get(o.id);
        if (s && s.status === "voided") return; // البيع انلغى من الكاشير: ما بنعرض الطلب
        const view = { ...o, _sale: s, _total: s && s._total, _left: s && s._left };
        if (o.status === "ready") next.notified.push(view);
        else if (s && s.kitchen_status === "جاهز") next.ready.push(view);
        else next.prep.push(view);
      });
      next.ready.sort((a, b) => String(a._sale.kitchen_ready_at || "").localeCompare(String(b._sale.kitchen_ready_at || "")));
      next.prep.sort((a, b) => Number(a.number) - Number(b.number));
      next.notified.sort((a, b) => Number(a.number) - Number(b.number));

      const readyIds = new Set(next.ready.map((o) => o.id));
      if (knownReady !== null) {
        let fresh = false;
        readyIds.forEach((id) => { if (!knownReady.has(id)) fresh = true; });
        if (fresh && !HEADLESS && typeof OlvSound !== "undefined" && OlvSound.playOrderReady) OlvSound.playOrderReady();
      }
      knownReady = readyIds;
      model = next;
      render();
      if (next.ready.length) autoNotify(next.ready);
    } catch (e) {
      /* اللوحة مساعدة، ما بنزعج الكاشير بخطأ منها */
    } finally {
      busy = false;
      if (again) { again = false; refresh(); }
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 500);
  }

  function init() {
    if (typeof OlvIncomingPoll === "undefined") return;
    ensureRoot();
    OlvIncomingPoll.subscribe((orders) => { lastOrders = orders || []; refresh(); });
    // لما المطبخ يشطب صنف أو يخلّص طلب بتنعكس اللوحة بلحظتها (بدون ما تستنى فحص الـ10 ثواني)
    const tryRealtime = () => {
      if (!window.supabaseClient || !window.supabaseClient.channel) return setTimeout(tryRealtime, 1500);
      try {
        window.supabaseClient.channel("menu-ready-panel-" + Math.random().toString(36).slice(2, 8))
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sales_entries" }, scheduleRefresh)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sale_items" }, scheduleRefresh)
          .subscribe();
      } catch (e) {}
    };
    tryRealtime();
    pickupLoaded = loadPickup();
    setInterval(() => { if (model.ready.length || model.notified.length) render(); }, 60000); // يحدّث «من N د»
  }

  window.OlvMenuReady = { refresh, orderRef };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
