// كتالوج المواد الجاهزة: بحث وإضافة دفعة وحدة للمخزون/المستلزمات بدل إدخال كل صنف يدويًا.
//   olvOpenCatalog({ kind: "i"|"s"|null, onDone })  ← نافذة الاختيار (المحدد بينضاف بكمية صفر)
//   olvCatalogFind()                                ← كل أصناف الكتالوج (بيحمّل الملف عند أول طلب)
//   olvCatalogAddOne(entry)                         ← يضيف صنف واحد ويرجّع { kind, row }
// البيانات بملف ثابت (assets/catalog-data.js) فما في SQL ولا جدول. الأصناف الموجودة عندك
// بنفس الاسم (بعد توحيد الحروف) بتنعلّم "موجود" وما بتنضاف مرتين.
(function () {
  const KIND_LABEL = { i: "مواد/بضاعة", s: "مستلزمات" };
  let loading = null;

  function olvCatNorm(s) {
    return String(s || "")
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  function loadData() {
    if (window.OLV_CATALOG) return Promise.resolve(window.OLV_CATALOG);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "assets/catalog-data.js";
      s.onload = () => resolve(window.OLV_CATALOG || []);
      s.onerror = () => { loading = null; reject(new Error("تعذّر تحميل الكتالوج")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  async function olvCatalogFind() {
    const raw = await loadData();
    return raw.map((r, i) => ({
      id: i, cat: r[0], kind: r[1], name: r[2], unit: r[3], pu: r[4] || null, pf: r[5] || null,
      key: olvCatNorm(r[2]), hay: olvCatNorm(r[2] + " " + r[6] + " " + r[0]),
    }));
  }

  async function existingKeys() {
    const [a, b] = await Promise.all([
      window.supabaseClient.from("ingredients").select("name"),
      window.supabaseClient.from("supplies").select("name"),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    return { i: new Set((a.data || []).map((r) => olvCatNorm(r.name))), s: new Set((b.data || []).map((r) => olvCatNorm(r.name))) };
  }

  function rowFor(e) {
    const base = { name: e.name, unit: e.unit, current_stock: 0, low_stock_threshold: 0 };
    if (e.pu && e.pf) { base.purchase_unit = e.pu; base.purchase_unit_factor = e.pf; }
    if (e.kind === "s") base.category = e.cat;
    return base;
  }

  // آمنة للتكرار: لو الصنف موجود أصلًا (بنفس الاسم بعد توحيد الحروف، أو انضاف للتو بنداء مزدوج)
  // بترجّع الصنف الموجود بدل ما تضيفه مرتين أو تفشل بـ duplicate key
  async function olvCatalogAddMany(entries) {
    const out = [];
    for (const kind of ["i", "s"]) {
      const list = entries.filter((e) => e.kind === kind);
      if (!list.length) continue;
      const table = kind === "i" ? "ingredients" : "supplies";
      const label = kind === "i" ? "ingredient" : "supply";
      const fetchExisting = async () => {
        const { data, error } = await window.supabaseClient.from(table).select("*");
        if (error) throw error;
        return new Map((data || []).map((r) => [olvCatNorm(r.name), r]));
      };
      let have = await fetchExisting();
      const seen = new Set();
      const fresh = [];
      for (const e of list) {
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        if (have.has(e.key)) out.push({ kind: label, row: have.get(e.key), existed: true });
        else fresh.push(e);
      }
      if (!fresh.length) continue;
      const { data, error } = await window.supabaseClient.from(table).insert(fresh.map(rowFor)).select();
      if (error) {
        if (error.code !== "23505") throw error;
        // سباق: نداء ثاني أضاف نفس الصنف بنفس اللحظة — نرجّع الموجود
        have = await fetchExisting();
        fresh.forEach((e) => { if (have.has(e.key)) out.push({ kind: label, row: have.get(e.key), existed: true }); });
        continue;
      }
      (data || []).forEach((r) => out.push({ kind: label, row: r }));
    }
    return out;
  }
  async function olvCatalogAddOne(entry) {
    const r = await olvCatalogAddMany([entry]);
    return r[0];
  }

  function injectStyles() {
    if (document.getElementById("olv-cat-style")) return;
    const st = document.createElement("style");
    st.id = "olv-cat-style";
    st.textContent = `
      .olv-cat-backdrop{position:fixed; inset:0; background:rgba(8,7,4,.6); backdrop-filter:blur(6px); z-index:200;
        display:flex; align-items:center; justify-content:center; padding:16px;}
      .olv-cat-modal{width:100%; max-width:640px; height:min(86vh,720px); display:flex; flex-direction:column; background:var(--ink-2);
        border:1px solid var(--hair); border-radius:20px; padding:18px; box-shadow:0 24px 60px rgba(0,0,0,.5);
        color:var(--paper); font-family:'Tajawal',sans-serif;}
      .olv-cat-modal h2{font-size:18px; margin:0 0 4px;}
      .olv-cat-sub{color:var(--muted); font-size:13px; margin-bottom:10px; line-height:1.6;}
      .olv-cat-search{width:100%; box-sizing:border-box; padding:12px; font-size:16px; border-radius:10px; border:1px solid var(--hair);
        background:var(--ink-3); color:var(--paper); font-family:inherit;}
      .olv-cat-chips{display:flex; gap:6px; overflow-x:auto; padding:10px 0; flex:none;}
      .olv-cat-chips button{flex:none; border:1px solid var(--hair); background:var(--ink-3); color:var(--paper); border-radius:999px;
        padding:6px 12px; font-size:12.5px; font-family:inherit; cursor:pointer; white-space:nowrap;}
      .olv-cat-chips button.on{background:var(--gold); color:var(--on-gold); border-color:var(--gold); font-weight:700;}
      .olv-cat-list{flex:1; overflow-y:auto; border:1px solid var(--hair-soft); border-radius:12px;}
      .olv-cat-row{display:flex; align-items:center; gap:10px; padding:9px 12px; border-bottom:1px solid var(--hair-soft); cursor:pointer;}
      .olv-cat-row:last-child{border-bottom:0;}
      .olv-cat-row.have{opacity:.45; cursor:default;}
      .olv-cat-row input{width:18px; height:18px; flex:none;}
      .olv-cat-row .nm{flex:1; font-size:14px;}
      .olv-cat-row .mt{font-size:12px; color:var(--muted); white-space:nowrap;}
      .olv-cat-foot{display:flex; gap:10px; margin-top:12px; align-items:center;}
      .olv-cat-foot .btn{min-height:44px;}
      .olv-cat-foot .cnt{flex:1; font-size:13px; color:var(--muted);}
      .olv-cat-err{color:var(--danger-hi); font-size:13px; min-height:18px;}
    `;
    document.head.appendChild(st);
  }

  async function olvOpenCatalog(opts) {
    opts = opts || {};
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.className = "olv-cat-backdrop";
    const modal = document.createElement("div");
    modal.className = "olv-cat-modal";
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    modal.innerHTML = `<h2>كتالوج المواد الجاهزة</h2><div class="olv-cat-sub">جاري التحميل...</div>`;

    let items, have;
    try {
      [items, have] = await Promise.all([olvCatalogFind(), existingKeys()]);
    } catch (err) {
      modal.innerHTML = `<h2>كتالوج المواد الجاهزة</h2><div class="olv-cat-err">${olvEsc((err && err.message) || "تعذّر التحميل")}</div>
        <div class="olv-cat-foot"><button type="button" class="btn" id="olv-cat-x">إغلاق</button></div>`;
      modal.querySelector("#olv-cat-x").addEventListener("click", close);
      return;
    }

    let kind = opts.kind || "all";
    let cat = "";
    const picked = new Set();
    const isHave = (e) => have[e.kind].has(e.key);

    modal.innerHTML = `
      <h2>كتالوج المواد الجاهزة</h2>
      <div class="olv-cat-sub">${items.length} صنف شائع بالكافيهات والمطاعم. ابحث (عربي أو إنجليزي، مثل: بيبسي، pepsi، كاسات)، حدد الأصناف اللي بدك، وبتنضاف لمخزونك بكمية صفر — عدّل الكمية والأسعار بعدين من الشاشة أو من فاتورة الشراء.</div>
      <input type="search" class="olv-cat-search" id="olv-cat-q" placeholder="ابحث باسم الصنف...">
      <div class="olv-cat-chips" id="olv-cat-kinds"></div>
      <div class="olv-cat-chips" id="olv-cat-cats"></div>
      <div class="olv-cat-list" id="olv-cat-list"></div>
      <div class="olv-cat-err" id="olv-cat-err"></div>
      <div class="olv-cat-foot">
        <div class="cnt" id="olv-cat-cnt"></div>
        <button type="button" class="btn gold" id="olv-cat-add">إضافة المحدد</button>
        <button type="button" class="btn" id="olv-cat-close">إغلاق</button>
      </div>`;
    const q = modal.querySelector("#olv-cat-q");
    const listEl = modal.querySelector("#olv-cat-list");
    const errEl = modal.querySelector("#olv-cat-err");
    const addBtn = modal.querySelector("#olv-cat-add");

    function visible() {
      const words = olvCatNorm(q.value).split(" ").filter(Boolean);
      return items.filter((e) => (kind === "all" || e.kind === kind) && (!cat || e.cat === cat) && words.every((w) => e.hay.includes(w)));
    }
    function renderChips() {
      const kinds = [["all", "الكل"], ["i", KIND_LABEL.i], ["s", KIND_LABEL.s]];
      modal.querySelector("#olv-cat-kinds").innerHTML = kinds.map(([k, l]) => `<button type="button" data-kind="${k}" class="${kind === k ? "on" : ""}">${l}</button>`).join("");
      const cats = [...new Set(items.filter((e) => kind === "all" || e.kind === kind).map((e) => e.cat))];
      modal.querySelector("#olv-cat-cats").innerHTML = [`<button type="button" data-cat="" class="${cat === "" ? "on" : ""}">كل التصنيفات</button>`]
        .concat(cats.map((c) => `<button type="button" data-cat="${olvEsc(c)}" class="${cat === c ? "on" : ""}">${olvEsc(c)}</button>`)).join("");
    }
    function renderList() {
      const rows = visible();
      const shown = rows.slice(0, 200);
      listEl.innerHTML = shown.map((e) => {
        const h = isHave(e);
        return `<label class="olv-cat-row${h ? " have" : ""}">
          <input type="checkbox" data-id="${e.id}"${h ? " disabled" : ""}${picked.has(e.id) ? " checked" : ""}>
          <span class="nm">${olvEsc(e.name)}</span>
          <span class="mt">${h ? "موجود عندك" : olvEsc(e.unit + (e.pu ? " · " + e.pu : ""))}</span>
        </label>`;
      }).join("") + (rows.length > shown.length ? `<div class="olv-cat-sub" style="padding:10px;">يوجد ${rows.length - shown.length} نتيجة إضافية — ضيّق البحث أو اختر تصنيفًا</div>` : "")
        || `<div class="olv-cat-sub" style="padding:14px;">ما في نتائج — جرّب كلمة ثانية</div>`;
      if (!rows.length) listEl.innerHTML = `<div class="olv-cat-sub" style="padding:14px;">ما في نتائج — جرّب كلمة ثانية</div>`;
      updateCount();
    }
    function updateCount() {
      modal.querySelector("#olv-cat-cnt").textContent = picked.size ? `محدد: ${picked.size}` : "";
      addBtn.disabled = !picked.size;
    }
    renderChips(); renderList();

    q.addEventListener("input", renderList);
    modal.querySelector("#olv-cat-kinds").addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind]"); if (!b) return;
      kind = b.dataset.kind; cat = ""; renderChips(); renderList();
    });
    modal.querySelector("#olv-cat-cats").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      cat = b.dataset.cat; renderChips(); renderList();
    });
    listEl.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) picked.add(id); else picked.delete(id);
      updateCount();
    });
    modal.querySelector("#olv-cat-close").addEventListener("click", close);
    addBtn.addEventListener("click", async () => {
      errEl.textContent = "";
      addBtn.disabled = true;
      try {
        const sel = items.filter((e) => picked.has(e.id) && !isHave(e));
        const added = (await olvCatalogAddMany(sel)).filter((a) => !a.existed);
        close();
        if (opts.onDone) await opts.onDone(added);
      } catch (err) {
        errEl.textContent = (typeof olvIsNetworkError === "function" && olvIsNetworkError(err)) ? "ما في اتصال بالإنترنت" : (err && err.message) || "تعذّرت الإضافة";
        addBtn.disabled = false;
      }
    });
    setTimeout(() => q.focus(), 50);
  }

  window.olvOpenCatalog = olvOpenCatalog;
  window.olvCatalogFind = olvCatalogFind;
  window.olvCatalogAddOne = olvCatalogAddOne;
  window.olvCatalogAddMany = olvCatalogAddMany;
  window.olvCatNorm = olvCatNorm;
})();
