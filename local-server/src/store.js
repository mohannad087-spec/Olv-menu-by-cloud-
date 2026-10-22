// مخزن طلبات المطبخ على كمبيوتر المحل (ملف JSON واحد بمجلد data/).
// فيه نوعين طلبات:
//  - "cloud": نسخة من طلبات «قيد التحضير» اللي بالسحابة، بتبعتها شاشات المطبخ وهي أونلاين
//    (snapshot)، حتى إذا انقطع النت تضل الطلبات اللي كانت عالشاشة موجودة.
//  - "local": طلب طلع من الكاشير والنت مقطوع (انحفظ بطابور الكاشير لحد ما يرجع النت).
// شطب الأصناف وقت الانقطاع بينحفظ هون ومعلّم "dirty"، وأول ما ترجع شاشة مطبخ أونلاين
// بترفعه للسحابة (هي اللي معها تسجيل الدخول؛ هالبرنامج ما معه أي مفتاح لقاعدة البيانات).
const fs = require("fs");
const path = require("path");

const KEEP_HOURS = 24;       // طلب أقدم من هيك بينشال (إلا إذا لسا في شطب ما ارتفع)
const KEEP_DIRTY_HOURS = 72;

function createStore(dataDir) {
  const file = path.join(dataDir, "orders.json");
  let state = { seq: 0, seqDay: "", orders: {}, prints: {} };
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(file, "utf8"))); } catch (_) { /* أول تشغيل */ }

  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file); // كتابة آمنة: ما بيخرب الملف إذا انطفى الكمبيوتر بنصها
    }, 50);
  }
  function flush() { clearTimeout(saveT); fs.writeFileSync(file, JSON.stringify(state)); }

  const now = () => new Date().toISOString();
  const isDirty = (o) => o.dirty && Object.keys(o.dirty).length > 0;
  const allDone = (o) => o.items.length > 0 && o.items.every((it) => it.kitchen_done_at);
  const hoursOld = (o) => (Date.now() - new Date(o.created_at).getTime()) / 3600e3;

  function prune() {
    let changed = false;
    for (const [k, o] of Object.entries(state.orders)) {
      const h = hoursOld(o);
      if (h > KEEP_DIRTY_HOURS || (h > KEEP_HOURS && !isDirty(o))) { delete state.orders[k]; changed = true; }
    }
    for (const [k, p] of Object.entries(state.prints || {})) {
      if ((Date.now() - new Date(p.created_at).getTime()) / 3600e3 > KEEP_DIRTY_HOURS) { delete state.prints[k]; changed = true; }
    }
    if (changed) save();
  }

  // رقم محلي قصير للطلب (م1، م2...) بيرجع من 1 كل يوم
  function nextLocalNo() {
    const day = new Date().toLocaleDateString("en-CA");
    if (state.seqDay !== day) { state.seqDay = day; state.seq = 0; }
    state.seq += 1;
    return state.seq;
  }

  const str = (v, max) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, max));

  // طلب جديد من الكاشير وقت الانقطاع. نفس client_ref مرتين = نفس الطلب (ما بيتكرر)
  function addLocalOrder(t) {
    const ref = str(t && t.client_ref, 64);
    if (!ref || !Array.isArray(t.items) || !t.items.length) throw new Error("طلب ناقص");
    const key = "local-" + ref;
    const existing = state.orders[key];
    if (existing) return existing;
    const o = {
      key, id: key, source: "local", client_ref: ref,
      local_no: nextLocalNo(),
      created_at: str(t.created_at, 40) || now(),
      order_type: str(t.order_type, 40),
      table_number: str(t.table_number, 20),
      customer_name: str(t.customer_name, 80),
      kitchen_ready_at: null,
      items: t.items.slice(0, 100).map((it, i) => ({
        id: key + "-" + i,
        product_name: str(it.product_name, 120) || "صنف",
        qty: Number(it.qty) || 1,
        addons_summary: str(it.addons_summary, 300),
        note: str(it.note, 300),
        category: str(it.category, 80),
        kitchen_done_at: null,
      })),
      dirty: {},
    };
    o.order_no = "م" + o.local_no;
    state.orders[key] = o;
    if (t.print && typeof t.print === "object") {
      state.prints = state.prints || {};
      state.prints[ref] = { id: ref, order_no: o.order_no, created_at: o.created_at, attempts: 0, done: false, sale: cleanPrint(t.print, o) };
    }
    save();
    return o;
  }

  // بيانات الطباعة اللي بيحتاجها جسر الطباعة ليرسم الفاتورة وتذاكر الأقسام (نفس حقول sales_entries/sale_items)
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  function cleanPrint(p, o) {
    return {
      order_no: o.order_no, created_at: o.created_at, order_type: o.order_type,
      table_number: o.table_number, customer_name: o.customer_name,
      customer_phone: str(p.customer_phone, 30), cashier_name: str(p.cashier_name, 80),
      cash_amount: num(p.cash_amount), card_amount: num(p.card_amount), delivery_amount: num(p.delivery_amount),
      discount_amount: num(p.discount_amount),
      cash_received: p.cash_received == null ? null : num(p.cash_received),
      change_due: p.change_due == null ? null : num(p.change_due),
      items: (Array.isArray(p.items) ? p.items : []).slice(0, 100).map((it) => ({
        product_name: str(it.product_name, 120) || "صنف", qty: num(it.qty) || 1,
        unit_price: num(it.unit_price), addons_total: num(it.addons_total),
        addons_summary: str(it.addons_summary, 300), note: str(it.note, 300), category: str(it.category, 80),
      })),
    };
  }

  // مهام الطباعة اللي لسا ما انطبعت (جسر الطباعة على نفس الكمبيوتر بيسحبها). بعد 5 محاولات فاشلة بنتركها
  // (لما يرجع النت وبترفع المبيعات للسحابة، السحابة بتطبعها بالطريقة العادية)
  function printPending() {
    return Object.values(state.prints || {}).filter((p) => !p.done && p.attempts < 5)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 20);
  }
  function printDone(id, ok, error) {
    const p = (state.prints || {})[String(id)];
    if (!p) return;
    if (ok) { p.done = true; p.done_at = now(); }
    else { p.attempts += 1; p.last_error = str(error, 200); }
    save();
  }

  // صورة طلبات «قيد التحضير» من السحابة (نفس شكل sales_entries + sale_items)
  function applySnapshot(rows) {
    if (!Array.isArray(rows)) throw new Error("صورة غير صالحة");
    const seen = new Set();
    const refs = new Set();
    for (const r of rows.slice(0, 300)) {
      if (!r || !r.id) continue;
      const key = String(r.id);
      seen.add(key);
      if (r.client_ref) refs.add(String(r.client_ref));
      const prev = state.orders[key];
      const items = (r.sale_items || []).filter((it) => it.status !== "voided").map((it) => {
        const id = String(it.id);
        // شطب محلي لسا ما ارتفع بيغلب اللي بالسحابة
        const local = prev && prev.dirty && Object.prototype.hasOwnProperty.call(prev.dirty, id)
          ? prev.items.find((x) => x.id === id) : null;
        return {
          id,
          product_name: str(it.product_name, 120) || "صنف",
          qty: Number(it.qty) || 1,
          addons_summary: str(it.addons_summary, 300),
          note: str(it.note, 300),
          category: str(it.products && it.products.category, 80),
          kitchen_done_at: local ? local.kitchen_done_at : (it.kitchen_done_at || null),
        };
      });
      state.orders[key] = {
        key, id: key, source: "cloud", client_ref: str(r.client_ref, 64),
        order_no: r.order_no ?? null,
        created_at: str(r.created_at, 40) || now(),
        order_type: str(r.order_type, 40),
        table_number: str(r.table_number, 20),
        customer_name: str(r.customer_name, 80),
        kitchen_ready_at: prev && isDirty(prev) ? prev.kitchen_ready_at : (r.kitchen_ready_at || null),
        items,
        dirty: prev && prev.dirty ? prev.dirty : {},
      };
    }
    for (const [k, o] of Object.entries(state.orders)) {
      if (isDirty(o)) continue;
      // طلب سحابي ما عاد «قيد التحضير» (خلص أو انلغى)، أو طلب محلي وصل للسحابة: ما عاد إلنا فيه
      if (o.source === "cloud" && !seen.has(k) && !o.kitchen_ready_at) delete state.orders[k];
      else if (o.source === "cloud" && !seen.has(k) && hoursOld(o) > 12) delete state.orders[k];
      else if (o.source === "local" && refs.has(o.client_ref)) delete state.orders[k];
    }
    save();
  }

  // شطب/إرجاع أصناف (نفس فكرة set_items_kitchen_done بالسحابة)
  function setDone(orderId, itemIds, done) {
    const o = state.orders[String(orderId)];
    if (!o) throw new Error("الطلب مش موجود");
    const ids = new Set((itemIds || []).map(String));
    const at = now();
    o.items.forEach((it) => {
      if (!ids.has(it.id)) return;
      it.kitchen_done_at = done ? at : null;
      o.dirty[it.id] = !!done;
    });
    o.kitchen_ready_at = allDone(o) ? (o.kitchen_ready_at || at) : null;
    save();
    return o;
  }

  // شكل بيفهمه kitchen.html (متل نتيجة select من Supabase)
  function toRow(o) {
    return {
      id: o.id, order_no: o.order_no, created_at: o.created_at, order_type: o.order_type,
      customer_name: o.customer_name, table_number: o.table_number, kitchen_ready_at: o.kitchen_ready_at,
      client_ref: o.client_ref, local: o.source === "local",
      sale_items: o.items.map((it) => ({
        id: it.id, qty: it.qty, product_name: it.product_name, addons_summary: it.addons_summary,
        note: it.note, status: "active", kitchen_done_at: it.kitchen_done_at, products: { category: it.category },
      })),
    };
  }

  function kitchenView() {
    prune();
    const list = Object.values(state.orders);
    // طلب محلي وصلت نسخته السحابية بالصورة: منعرض وحدة بس
    const shown = list.filter((o) => !(o.source === "cloud" && o.client_ref && list.some((x) => x.source === "local" && x.client_ref === o.client_ref)));
    const pending = shown.filter((o) => !allDone(o)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ready = shown.filter((o) => allDone(o) && hoursOld(o) <= 12)
      .sort((a, b) => (b.kitchen_ready_at || "").localeCompare(a.kitchen_ready_at || "")).slice(0, 60);
    return { pending: pending.map(toRow), ready: ready.map(toRow) };
  }

  // شطب لسا ما ارتفع للسحابة، وكل طلب محلي (لازم الشاشة تتأكد إنو وصل للسحابة حتى ننساه)
  function dirtyList() {
    return Object.values(state.orders).filter((o) => isDirty(o) || o.source === "local").map((o) => ({
      id: o.id, source: o.source, client_ref: o.client_ref, dirty: o.dirty,
      items: o.items.map((it) => ({ id: it.id, product_name: it.product_name, qty: it.qty })),
    }));
  }

  // انرفع للسحابة: منشيل العلامة بس إذا ما تغيّرت بالنص
  // uploaded: الطلب المحلي صار موجود بالسحابة (الكاشير رفعه)، فمن هلق بتعرضه الشاشات من هناك
  function markSynced(orderId, synced, uploaded) {
    const o = state.orders[String(orderId)];
    if (!o) return;
    for (const [id, v] of Object.entries(synced || {})) {
      if (o.dirty[id] === v) delete o.dirty[id];
    }
    if (uploaded && o.source === "local" && !isDirty(o)) delete state.orders[o.key];
    save();
  }

  return { addLocalOrder, applySnapshot, setDone, kitchenView, dirtyList, markSynced, prune, flush, printPending, printDone };
}

module.exports = { createStore };
