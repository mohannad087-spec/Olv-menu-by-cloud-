// إعادة طباعة فاتورة مع سبب إلزامي (schema-reprint.sql). مشتركة بين شاشة
// البيع السريع وسجل المبيعات:
//   olvReprintSale(saleId, label)  ← يفتح نافذة السبب، وبعد التأكيد بيستدعي
//                                    reprint_receipt ويرجّع رقم النسخة (أو null لو تراجع)
//   olvOpenReprintList()           ← نافذة آخر 10 فواتير للكاشير الحالي بزر إعادة
//                                    طباعة لكل واحدة (أول واحدة = آخر فاتورة)
// إعادة الطباعة ما بتنحفظ أوفلاين (offline-queue.js بيستثنيها): لو ما في نت
// بتفشل بوضوح بدل ما تنطبع فجأة بعد ساعات
(function () {
  const QUICK_REASONS = [
    "الزبون طلب نسخة",
    "الطابعة ما طبعت (ورق/عطل)",
    "ضاعت الفاتورة",
    "خطأ بالطباعة الأولى",
  ];

  function injectStyles() {
    if (document.getElementById("olv-rp-style")) return;
    const st = document.createElement("style");
    st.id = "olv-rp-style";
    st.textContent = `
      .olv-rp-backdrop{position:fixed; inset:0; background:rgba(8,7,4,.6); backdrop-filter:blur(6px); z-index:200;
        display:flex; align-items:center; justify-content:center; padding:20px;}
      .olv-rp-modal{width:100%; max-width:440px; max-height:90vh; overflow-y:auto; background:var(--ink-2);
        border:1px solid var(--hair); border-radius:20px; padding:22px 22px 20px; box-shadow:0 24px 60px rgba(0,0,0,.5);
        color:var(--paper); font-family:'Tajawal',sans-serif;}
      .olv-rp-modal h2{font-size:18px; margin:0 0 4px;}
      .olv-rp-sub{color:var(--muted); font-size:13px; margin-bottom:12px; line-height:1.6;}
      .olv-rp-chips{display:flex; flex-wrap:wrap; gap:8px; margin:10px 0;}
      .olv-rp-chips button{border:1px solid var(--hair); background:var(--ink-3); color:var(--paper); border-radius:999px;
        padding:8px 12px; font-size:13px; font-family:inherit; cursor:pointer;}
      .olv-rp-chips button.on{background:var(--gold); color:var(--on-gold); border-color:var(--gold); font-weight:700;}
      .olv-rp-modal input[type=text]{width:100%; box-sizing:border-box; padding:12px; font-size:16px; border-radius:10px;
        border:1px solid var(--hair); background:var(--ink-3); color:var(--paper); font-family:inherit;}
      .olv-rp-actions{display:flex; gap:10px; margin-top:14px;}
      .olv-rp-actions .btn{flex:1; min-height:46px;}
      .olv-rp-err{color:var(--danger-hi); font-size:13px; margin-top:10px; min-height:18px;}
      .olv-rp-list{display:flex; flex-direction:column; gap:8px; margin-top:8px;}
      .olv-rp-row{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px;
        border:1px solid var(--hair-soft); border-radius:12px; background:var(--ink-3);}
      .olv-rp-row .meta{font-size:12.5px; color:var(--muted); margin-top:2px;}
      .olv-rp-row.last{border-color:var(--gold);}
      .olv-rp-tag{display:inline-block; font-size:11px; background:var(--gold); color:var(--on-gold); border-radius:999px;
        padding:1px 8px; margin-inline-start:6px; font-weight:700;}
      .olv-rp-ok{color:var(--ok); font-weight:700; text-align:center; padding:14px 0;}
    `;
    document.head.appendChild(st);
  }

  function makeModal() {
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.className = "olv-rp-backdrop olv-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "olv-rp-modal";
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    const close = () => (window.olvDismiss ? olvDismiss(backdrop) : backdrop.remove());
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    return { modal, close };
  }

  // يرجّع رقم النسخة لو نجحت، أو null لو الكاشير تراجع
  function olvReprintSale(saleId, label) {
    return new Promise((resolve) => {
      const { modal, close } = makeModal();
      let busy = false;
      modal.innerHTML = `
        <h2>إعادة طباعة الفاتورة</h2>
        <div class="olv-rp-sub">${olvEsc(label || "")}<br>سبب الإعادة إلزامي، وبيطلع مكتوب على النسخة المطبوعة وبسجل الفاتورة.</div>
        <div class="olv-rp-chips">${QUICK_REASONS.map((r) => `<button type="button">${olvEsc(r)}</button>`).join("")}</div>
        <input type="text" id="olv-rp-reason" maxlength="200" placeholder="اكتب سبب الإعادة...">
        <div class="olv-rp-err" id="olv-rp-err"></div>
        <div class="olv-rp-actions">
          <button type="button" class="btn gold" id="olv-rp-go">طباعة النسخة</button>
          <button type="button" class="btn" id="olv-rp-cancel">إلغاء</button>
        </div>`;
      const input = modal.querySelector("#olv-rp-reason");
      const errEl = modal.querySelector("#olv-rp-err");
      const goBtn = modal.querySelector("#olv-rp-go");
      modal.querySelectorAll(".olv-rp-chips button").forEach((b) => {
        b.addEventListener("click", () => {
          modal.querySelectorAll(".olv-rp-chips button").forEach((x) => x.classList.toggle("on", x === b));
          input.value = b.textContent;
          errEl.textContent = "";
        });
      });
      modal.querySelector("#olv-rp-cancel").addEventListener("click", () => { close(); resolve(null); });
      goBtn.addEventListener("click", async () => {
        if (busy) return;
        const reason = input.value.trim();
        if (reason.length < 3) { errEl.textContent = "اكتب سبب واضح للإعادة (3 أحرف على الأقل)"; input.focus(); return; }
        busy = true; goBtn.disabled = true; errEl.textContent = "";
        try {
          const { data, error } = await window.supabaseClient.rpc("reprint_receipt", { p_sale_id: saleId, p_reason: reason });
          if (error) throw error;
          modal.innerHTML = `<div class="olv-rp-ok">${olvIcon("check")} أُرسلت النسخة رقم ${olvEsc(data)} للطباعة</div>`;
          if (typeof OlvSound !== "undefined") OlvSound.playSuccess();
          setTimeout(() => { close(); resolve(data); }, 1100);
        } catch (err) {
          busy = false; goBtn.disabled = false;
          errEl.textContent = olvIsNetworkError(err)
            ? "ما في اتصال بالإنترنت — إعادة الطباعة بتحتاج نت، حاول لما يرجع"
            : (err && err.message) || "تعذّرت إعادة الطباعة";
          if (typeof OlvSound !== "undefined") OlvSound.playError();
        }
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  async function olvOpenReprintList() {
    const { modal, close } = makeModal();
    modal.innerHTML = `<h2>إعادة طباعة فاتورة</h2><div class="olv-rp-sub">جاري التحميل...</div>`;
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      const { data: sales, error } = await window.supabaseClient
        .from("sales_entries")
        .select("id, order_no, created_at, cash_amount, card_amount, delivery_amount, customer_name, table_number")
        .eq("created_by", session.user.id).eq("status", "completed")
        .order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      let counts = {};
      if (sales && sales.length) {
        const { data: rp } = await window.supabaseClient
          .from("receipt_reprints").select("sale_id").in("sale_id", sales.map((s) => s.id));
        (rp || []).forEach((r) => { counts[r.sale_id] = (counts[r.sale_id] || 0) + 1; });
      }
      const rows = (sales || []).map((s, i) => {
        const total = Number(s.cash_amount) + Number(s.card_amount) + Number(s.delivery_amount);
        const time = new Date(s.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
        const who = [s.customer_name, s.table_number ? "طاولة " + s.table_number : ""].filter(Boolean).join(" — ");
        return `<div class="olv-rp-row${i === 0 ? " last" : ""}">
          <div>
            <b>${s.order_no ? "طلب " + olvEsc(s.order_no) : "فاتورة"}</b>${i === 0 ? '<span class="olv-rp-tag">آخر فاتورة</span>' : ""}
            <div class="meta">${olvEsc(time)} — ${olvFormatMoney(total)}${who ? " — " + olvEsc(who) : ""}${counts[s.id] ? ` — أُعيدت ${counts[s.id]}×` : ""}</div>
          </div>
          <button type="button" class="btn small gold" data-rp="${olvEsc(s.id)}" data-label="${olvEsc((s.order_no ? "طلب " + s.order_no : "فاتورة") + " — " + olvFormatMoney(total))}">${olvIcon("printer")} إعادة</button>
        </div>`;
      });
      modal.innerHTML = `<h2>إعادة طباعة فاتورة</h2>
        <div class="olv-rp-sub">آخر 10 فواتير لك. بتطلب منك سبب الإعادة قبل الطباعة.</div>
        <div class="olv-rp-list">${rows.join("") || '<div class="olv-rp-sub">ما في فواتير مسجّلة باسمك بعد.</div>'}</div>
        <div class="olv-rp-actions"><button type="button" class="btn" id="olv-rp-close">إغلاق</button></div>`;
      modal.querySelector("#olv-rp-close").addEventListener("click", close);
      modal.querySelectorAll("button[data-rp]").forEach((b) => {
        b.addEventListener("click", async () => {
          const done = await olvReprintSale(b.dataset.rp, b.dataset.label);
          if (done) close();
        });
      });
    } catch (err) {
      modal.innerHTML = `<h2>إعادة طباعة فاتورة</h2><div class="olv-rp-err">${olvEsc(olvIsNetworkError(err) ? "ما في اتصال بالإنترنت" : (err && err.message) || "تعذّر التحميل")}</div>
        <div class="olv-rp-actions"><button type="button" class="btn" id="olv-rp-close">إغلاق</button></div>`;
      modal.querySelector("#olv-rp-close").addEventListener("click", close);
    }
  }

  window.olvReprintSale = olvReprintSale;
  window.olvOpenReprintList = olvOpenReprintList;
})();
