// منطق مشترك بين شاشة "بيع سريع" وشاشة "المبيعات" (كلاهما يبيع أصناف
// من المنيو، وكلاهما ينزّل الخامات من المخزون عبر نفس دالة record_sale)
const OlvCart = (function () {
  let items = []; // {productId, name, unitBase, addons:[{id,name,price}], qty, note}

  function add(product, addons, qty, note) {
    items.push({
      productId: product.id,
      name: product.name,
      unitBase: Number(product.price),
      addons: addons.map((a) => ({ id: a.id, name: a.name, price: Number(a.price) })),
      qty,
      note: note || "",
    });
  }

  function removeAt(idx) {
    items.splice(idx, 1);
  }

  function clear() {
    items = [];
  }

  function all() {
    return items;
  }

  function restore(savedItems) {
    items = Array.isArray(savedItems) ? savedItems : [];
  }

  function lineTotal(item) {
    const addonsTotal = item.addons.reduce((s, a) => s + a.price, 0);
    return (item.unitBase + addonsTotal) * item.qty;
  }

  function total() {
    return items.reduce((s, item) => s + lineTotal(item), 0);
  }

  async function checkout({ paymentMethod, entryDate, extraNotes, orderType, cashReceived, changeDue }) {
    if (!items.length) throw new Error("السلة فاضية");
    const grand = total();
    const notesParts = items.map((item) => {
      const addonsTxt = item.addons.length ? ` (${item.addons.map((a) => a.name).join("، ")})` : "";
      const noteTxt = item.note ? ` [${item.note}]` : "";
      return `${item.qty}x ${item.name}${addonsTxt}${noteTxt}`;
    });
    if (extraNotes) notesParts.push(extraNotes);
    const notes = notesParts.join("، ");

    const rpcItems = items.map((item) => ({
      product_id: item.productId,
      qty: item.qty,
      addon_ids: item.addons.map((a) => a.id),
      note: item.note || null,
    }));

    const { data, error } = await window.supabaseClient.rpc("record_sale", {
      p_entry_date: entryDate,
      p_cash: paymentMethod === "cash" ? grand : 0,
      p_card: paymentMethod === "card" ? grand : 0,
      p_delivery: paymentMethod === "delivery" ? grand : 0,
      p_notes: notes,
      p_items: rpcItems,
      p_order_type: orderType || null,
      p_cash_received: cashReceived ?? null,
      p_change_due: changeDue ?? null,
    });
    if (error) throw error;
    clear();
    return data;
  }

  return { add, removeAt, clear, all, restore, lineTotal, total, checkout };
})();
