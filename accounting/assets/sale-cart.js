// منطق مشترك بين شاشة "بيع سريع" وشاشة "المبيعات" (كلاهما يبيع أصناف
// من المنيو، وكلاهما ينزّل الخامات من المخزون عبر نفس دالة record_sale)
const OlvCart = (function () {
  let items = []; // {productId, name, unitBase, addons:[{id,name,price}], qty, note}
  // رقم مرجعي للبيع الحالي (record_sale p_client_ref): نفس الرقم لكل محاولات دفع نفس السلة،
  // فإذا الطلب وصل للسيرفر والرد ضاع (انقطاع نت) وانعاد إرساله، ما بيتسجّل البيع مرتين.
  // بيتجدد مع أي تغيير بالسلة.
  let saleRef = null;
  let refSupported = true; // بيصير false إذا السيرفر لسا ما فيه schema-sale-idempotency.sql
  const touch = () => { saleRef = null; };
  const newRef = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

  function add(product, addons, qty, note) {
    touch();
    items.push({
      productId: product.id,
      name: product.name,
      category: product.category || null, // لشاشة المطبخ المحلية وقت انقطاع النت (أي محطة بتحضّره)
      unitBase: Number(product.price),
      addons: addons.map((a) => ({ id: a.id, name: a.name, price: Number(a.price) })),
      qty,
      note: note || "",
    });
  }

  function removeAt(idx) {
    touch();
    items.splice(idx, 1);
  }

  // يعدّل بيانات سطر موجود بالسلة (الكمية/الإضافات/الملاحظة) — تُستخدم
  // لما يفتح المستخدم سطرًا بالتذكرة عشان يخصّصه بعد الإضافة السريعة
  function updateAt(idx, patch) {
    touch();
    const item = items[idx];
    if (!item) return;
    Object.assign(item, patch);
  }

  // يزيد/ينقص كمية سطر موجود مباشرة (بدون فتح شاشة التخصيص) — الحد الأدنى 1
  function incrementQtyAt(idx, delta) {
    touch();
    const item = items[idx];
    if (!item) return;
    item.qty = Math.max(1, item.qty + delta);
  }

  function clear() {
    touch();
    items = [];
  }

  function all() {
    return items;
  }

  function restore(savedItems) {
    touch();
    items = Array.isArray(savedItems) ? savedItems : [];
  }

  function lineTotal(item) {
    const addonsTotal = item.addons.reduce((s, a) => s + a.price, 0);
    return (item.unitBase + addonsTotal) * item.qty;
  }

  function total() {
    return items.reduce((s, item) => s + lineTotal(item), 0);
  }

  async function checkout({ paymentMethod, entryDate, extraNotes, orderType, cashReceived, changeDue, tableNumber, customerPhone, customerName, discountAmount }) {
    if (!items.length) throw new Error("السلة فاضية");
    const subtotal = total();
    // الخصم يُطبّق هون قبل التوزيع على كاش/شبكة/توصيل — لا يوجد عمود خصم مخصص
    // بجدول المبيعات حاليًا، فبنسجّله كملاحظة بس المبلغ الفعلي المحصّل هو الصافي بعد الخصم
    const discount = Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal);
    const grand = subtotal - discount;
    const notesParts = items.map((item) => {
      const addonsTxt = item.addons.length ? ` (${item.addons.map((a) => a.name).join("، ")})` : "";
      const noteTxt = item.note ? ` [${item.note}]` : "";
      return `${item.qty}x ${item.name}${addonsTxt}${noteTxt}`;
    });
    if (discount > 0) notesParts.push(`خصم ${olvFormatMoney(discount)}`);
    if (extraNotes) notesParts.push(extraNotes);
    const notes = notesParts.join("، ");

    const rpcItems = items.map((item) => ({
      product_id: item.productId,
      qty: item.qty,
      addon_ids: item.addons.map((a) => a.id),
      note: item.note || null,
    }));

    if (!saleRef) saleRef = newRef();
    const args = {
      p_entry_date: entryDate,
      p_cash: paymentMethod === "cash" ? grand : 0,
      p_card: paymentMethod === "card" ? grand : 0,
      p_delivery: paymentMethod === "delivery" ? grand : 0,
      p_notes: notes,
      p_items: rpcItems,
      p_order_type: orderType || null,
      p_cash_received: cashReceived ?? null,
      p_change_due: changeDue ?? null,
      p_table_number: tableNumber ?? null,
      p_customer_phone: customerPhone ?? null,
      p_customer_name: customerName ?? null,
    };
    const queuedBefore = window.olvGetOfflineQueueCount ? window.olvGetOfflineQueueCount() : 0;
    const ref = saleRef;
    const sentItems = items.slice();
    let { data, error } = await window.supabaseClient.rpc("record_sale", refSupported ? { ...args, p_client_ref: saleRef } : args);
    if (error && refSupported && (error.code === "PGRST202" || /p_client_ref/.test(error.message || ""))) {
      refSupported = false;
      ({ data, error } = await window.supabaseClient.rpc("record_sale", args));
    }
    if (error) throw error;
    // النت مقطوع والبيع انحفظ بطابور الكاشير: منبعت نسخة لكمبيوتر المحل حتى توصل للمطبخ والبارات هلق
    const queued = !!(window.olvGetOfflineQueueCount && window.olvGetOfflineQueueCount() > queuedBefore);
    lastOffline = { queued, sentToKitchen: false, orderNo: null };
    if (queued && window.OlvLocal && window.OlvLocal.enabled) {
      try {
        const r = await window.OlvLocal.post("orders", {
          client_ref: ref,
          created_at: new Date().toISOString(),
          order_type: orderType || null,
          table_number: tableNumber ?? null,
          customer_name: customerName ?? null,
          // بيانات الطباعة: جسر الطباعة على كمبيوتر المحل بيطبع الفاتورة وتذاكر الأقسام من غير نت
          print: {
            customer_phone: customerPhone ?? null,
            cash_amount: args.p_cash, card_amount: args.p_card, delivery_amount: args.p_delivery,
            discount_amount: discount, cash_received: cashReceived ?? null, change_due: changeDue ?? null,
            items: sentItems.map((item) => ({
              product_name: item.name,
              qty: item.qty,
              unit_price: item.unitBase,
              addons_total: item.addons.reduce((s, a) => s + a.price, 0),
              addons_summary: item.addons.length ? item.addons.map((a) => a.name).join("، ") : null,
              note: item.note || null,
              category: item.category || (window.olvCategoryOf ? window.olvCategoryOf(item.productId) : null),
            })),
          },
          items: sentItems.map((item) => ({
            product_name: item.name,
            qty: item.qty,
            addons_summary: item.addons.length ? item.addons.map((a) => a.name).join("، ") : null,
            note: item.note || null,
            category: item.category || (window.olvCategoryOf ? window.olvCategoryOf(item.productId) : null),
          })),
        });
        lastOffline = { queued, sentToKitchen: true, orderNo: r.order_no || null };
      } catch (e) {
        console.error("olv-local: الطلب ما وصل لكمبيوتر المحل", e);
      }
    }
    clear();
    return data;
  }

  // آخر بيع: انحفظ بدون نت؟ ووصل للمطبخ عن طريق كمبيوتر المحل؟ (بتقرأها شاشة الكاشير)
  let lastOffline = { queued: false, sentToKitchen: false, orderNo: null };

  return { add, removeAt, updateAt, incrementQtyAt, clear, all, restore, lineTotal, total, checkout, lastOffline: () => lastOffline };
})();
