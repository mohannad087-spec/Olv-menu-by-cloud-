// إضافة بالذكاء الاصطناعي: مواد خام، مستلزمات، موردين، وبطاقات منيو — من نص أو صورة.
// بيضيف زر «✨ إضافة بالذكاء الاصطناعي» بأول الصفحة، وبيفتح نافذة: تكتب/تلصق نص أو تختار صورة،
// الدالة ai-assist بترجع اقتراحات، وأنت بتراجعها وتعدّلها وبتختار شو ينضاف. ما بينحفظ شي قبل
// «إضافة المحدد»، وما في حذف ولا تعديل على كميات مواد موجودة.
// الصفحات اللي بتضمّه: inventory.html، supplies.html، suppliers.html، menu-stock.html
(function () {
  const UNITS = ["كيلوغرام", "غرام", "لتر", "مليلتر", "قطعة", "علبة", "كيس", "زجاجة", "عبوة", "رول", "حزمة"];
  const KIND = { ingredient: "مادة خام", supply: "مستلزم" };
  const esc = (s) => (typeof olvEsc === "function" ? olvEsc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const norm = (s) => (typeof olvSearchNorm === "function" ? olvSearchNorm(s) : String(s || "").trim().toLowerCase());
  const toast = (m, o) => (typeof olvToast === "function" ? olvToast(m, o) : alert(m));
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  const css = `
  .aia-launch{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 12px;}
  .aia-back{position:fixed; inset:0; background:rgba(8,7,4,.6); z-index:200; display:flex; align-items:flex-start; justify-content:center; padding:16px; overflow:auto;}
  .aia-panel{background:var(--ink-2); border:1px solid var(--gold); border-radius:14px; width:100%; max-width:900px; padding:16px; margin:auto 0; box-sizing:border-box;}
  .aia-panel h2{margin:0 0 6px; font-size:18px;}
  .aia-panel textarea{width:100%; min-height:120px; background:var(--ink-3); border:1px solid var(--hair); color:var(--paper); padding:12px; border-radius:10px; font-family:'Tajawal',sans-serif; font-size:16px; box-sizing:border-box; resize:vertical;}
  .aia-row{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px;}
  .aia-sec{margin-top:14px;}
  .aia-sec h3{font-size:15px; margin:0 0 6px;}
  .aia-item{border:1px solid var(--hair); border-radius:10px; padding:10px; margin-top:8px; background:var(--ink-3);}
  .aia-item.off{opacity:.55;}
  .aia-head{display:flex; gap:8px; align-items:center; font-weight:700;}
  .aia-head input[type=checkbox]{width:20px; height:20px; flex:none;}
  .aia-head .aia-name{flex:1; min-width:0;}
  .aia-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin-top:8px;}
  .aia-grid label{display:block; font-size:11.5px; color:var(--muted); margin-bottom:3px;}
  .aia-panel input[type=text],.aia-panel input[type=number],.aia-panel input[type=tel],.aia-panel select{width:100%; box-sizing:border-box; padding:9px 8px; font-size:15px; background:var(--ink-2); border:1px solid var(--hair); color:var(--paper); border-radius:8px; font-family:'Tajawal',sans-serif;}
  .aia-tag{font-size:11.5px; font-weight:400; color:var(--muted); white-space:nowrap;}
  .aia-tag.ok{color:var(--ok);}
  .aia-err{color:var(--danger-hi); font-size:13px; min-height:16px; margin-top:8px;}
  `;

  let sb, suppliers = [], ingredients = [], supplies = [];
  let props = null; // { sups: [...], mats: [...] }

  async function loadExisting() {
    const [s, i, u] = await Promise.all([
      sb.from("suppliers").select("id, name, phone").order("name"),
      sb.from("ingredients").select("id, name, unit, menu_group, menu_variant").order("name"),
      sb.from("supplies").select("id, name, unit, supplier_id").order("name"),
    ]);
    [s, i, u].forEach((r) => { if (r.error) throw r.error; });
    suppliers = s.data || []; ingredients = i.data || []; supplies = u.data || [];
  }
  const existingByKey = (key) => {
    if (!key) return null;
    const [kind, id] = key.split(":");
    const row = (kind === "ingredient" ? ingredients : supplies).find((x) => x.id === id);
    return row ? Object.assign({ kind }, row) : null;
  };
  const existingByName = (name, kind) => {
    const n = norm(name);
    const pick = (list, k) => { const r = list.find((x) => norm(x.name) === n); return r ? Object.assign({ kind: k }, r) : null; };
    return kind === "supply" ? pick(supplies, "supply") || pick(ingredients, "ingredient") : pick(ingredients, "ingredient") || pick(supplies, "supply");
  };

  // يصغّر الصورة (أطول ضلع 1800px، JPEG) قبل الإرسال
  function fileToPayload(file) {
    return new Promise((resolve, reject) => {
      const readRaw = () => {
        if (file.size > 5 * 1024 * 1024) { reject(new Error("الملف أكبر من 5 ميغا — صغّره أو صوّره من جديد")); return; }
        const fr = new FileReader();
        fr.onload = () => resolve({ mime_type: file.type || "application/octet-stream", data: String(fr.result).split(",")[1] });
        fr.onerror = () => reject(new Error("تعذّرت قراءة الملف"));
        fr.readAsDataURL(file);
      };
      if (!file.type.startsWith("image/") || file.type === "image/heic") { readRaw(); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ mime_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); readRaw(); };
      img.src = url;
    });
  }

  function open() {
    sb = window.supabaseClient;
    if (!sb) return;
    props = null;
    let file = null;
    const back = document.createElement("div");
    back.className = "aia-back";
    back.innerHTML = `<div class="aia-panel" role="dialog" aria-modal="true" aria-label="إضافة بالذكاء الاصطناعي">
      <h2>✨ إضافة بالذكاء الاصطناعي</h2>
      <div class="hint" style="margin:0 0 10px;">اكتب أو الصق قائمة مواد، قائمة أسعار مورّد، رسالة واتساب، أو اطلب مباشرة (مثلًا: «ضيف مورّد أبو سامر 0791234567 وعنده كرتونة كاسات 1000 حبة» أو «اعمل بطاقة مشروب غازي فيها كولا وسبرايت»). أو اختر صورة فاتورة/ورقة. بتراجع كل شي قبل ما ينضاف.</div>
      <textarea id="aia-text" maxlength="6000" placeholder="اكتب أو الصق هون، أو الصق سكرين شوت..."></textarea>
      <div class="aia-row">
        <label class="btn" for="aia-file">📷 صورة أو PDF</label>
        <input type="file" id="aia-file" accept="image/*,application/pdf" hidden>
        <span class="aia-tag" id="aia-fname"></span>
        <button type="button" class="btn gold" id="aia-go">✨ حلّل</button>
        <button type="button" class="btn" id="aia-close">إغلاق</button>
      </div>
      <div class="hint" id="aia-status" style="margin:8px 0 0;"></div>
      <div id="aia-review"></div>
      <div class="aia-err" id="aia-err"></div>
    </div>`;
    document.body.appendChild(back);
    const q = (id) => back.querySelector("#" + id);
    const setFile = (f) => { file = f || null; q("aia-fname").textContent = file ? "📎 " + (file.name || "صورة ملصوقة") : ""; };
    const close = () => {
      if (props && (props.sups.length || props.mats.length) && !confirm("الاقتراحات ما انضافت — تسكّر بدون إضافة؟")) return;
      typeof olvDismiss === "function" ? olvDismiss(back) : back.remove();
    };
    q("aia-close").addEventListener("click", close);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    q("aia-file").addEventListener("change", (e) => setFile(e.target.files[0]));
    q("aia-text").addEventListener("paste", (e) => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); setFile(f); }
    });
    q("aia-text").focus();

    q("aia-go").addEventListener("click", async () => {
      const text = q("aia-text").value.trim();
      q("aia-err").textContent = "";
      if (!text && !file) { q("aia-err").textContent = "اكتب أو الصق نص، أو اختر صورة"; return; }
      if (!navigator.onLine) { q("aia-err").textContent = "التحليل بيحتاج إنترنت"; return; }
      const btn = q("aia-go"); btn.disabled = true;
      q("aia-status").textContent = "عم يحلّل... (10–30 ثانية)";
      try {
        const body = { text };
        if (file) Object.assign(body, await fileToPayload(file));
        const { data: { session } } = await sb.auth.getSession();
        const cfg = window.OLV_ACCOUNTING_CONFIG || {};
        const [res] = await Promise.all([
          fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/ai-assist", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + session.access_token, apikey: cfg.SUPABASE_ANON_KEY },
            body: JSON.stringify(body),
          }),
          loadExisting(),
        ]);
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || "فشل التحليل (" + res.status + ")");
        props = buildProposals(out);
        const nNew = props.mats.filter((m) => !m.ex).length + props.sups.filter((s) => !s.ex).length;
        q("aia-status").textContent = (props.mats.length || props.sups.length)
          ? `طلع ${nNew} جديد للإضافة${props.mats.some((m) => m.ex) ? " (والموجود أصلًا معلّم «موجود»)" : ""}. راجع وعدّل وبعدها اضغط «إضافة المحدد».`
          : "ما لقيت مواد أو موردين بالنص أو الصورة — جرّب صياغة أوضح.";
        renderReview(back);
      } catch (err) {
        q("aia-status").textContent = "";
        q("aia-err").textContent = err.message || String(err);
      } finally { btn.disabled = false; }
    });
  }

  function buildProposals(out) {
    const sups = [];
    (out.suppliers || []).forEach((s) => {
      const ex = s.existing_id ? suppliers.find((x) => x.id === s.existing_id) : suppliers.find((x) => norm(x.name) === norm(s.name));
      if (sups.some((x) => norm(x.name) === norm(s.name))) return;
      sups.push({ on: !ex, ex: ex || null, name: s.name, phone: s.phone || "", notes: s.notes || "" });
    });
    const mats = [];
    (out.materials || []).forEach((m) => {
      if (mats.some((x) => norm(x.name) === norm(m.name))) return;
      const ex = existingByKey(m.existing_key) || existingByName(m.name, m.kind);
      // المورّد: موجود (معرّف) أو جديد من نفس الاقتراحات (بالاسم)
      let sup = m.supplier_id || "";
      if (!sup && m.supplier_name) {
        const exS = suppliers.find((x) => norm(x.name) === norm(m.supplier_name));
        if (exS) sup = exS.id;
        else {
          if (!sups.some((x) => norm(x.name) === norm(m.supplier_name))) sups.push({ on: true, ex: null, name: m.supplier_name, phone: "", notes: "" });
          sup = "new:" + norm(m.supplier_name);
        }
      }
      const kind = ex ? ex.kind : m.kind;
      const card = kind === "ingredient" ? (m.card || "") : "";
      mats.push({
        ex, kind, sup, card, variant: card ? (m.variant || "") : "",
        // مادة موجودة: بس الربط بالمورّد أو البطاقة، فبتنعلّم إذا في شي منهم جديد
        on: ex ? !!(card && card !== (ex.menu_group || "")) || !!sup : true,
        name: ex ? ex.name : m.name, unit: ex ? ex.unit : m.unit,
        pu: m.purchase_unit || "", pf: m.purchase_factor ? String(m.purchase_factor) : "",
        stock: m.stock == null ? "" : String(m.stock),
        price: m.price == null ? "" : String(m.price), per: m.price_per || "stock",
      });
    });
    return { sups, mats };
  }

  function supOptions(sel) {
    const newOnes = props.sups.filter((s) => !s.ex && s.on);
    return `<option value="">— بدون مورّد —</option>`
      + suppliers.map((s) => `<option value="${s.id}"${s.id === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("")
      + newOnes.map((s) => { const v = "new:" + norm(s.name); return `<option value="${esc(v)}"${v === sel ? " selected" : ""}>＋ ${esc(s.name)} (جديد)</option>`; }).join("");
  }

  function renderReview(back) {
    const box = back.querySelector("#aia-review");
    if (!props || (!props.sups.length && !props.mats.length)) { box.innerHTML = ""; return; }
    const supHtml = props.sups.map((s, i) => `<div class="aia-item${s.on ? "" : " off"}">
        <div class="aia-head"><input type="checkbox" data-s-on="${i}"${s.on ? " checked" : ""}${s.ex ? " disabled" : ""} aria-label="إضافة المورّد">
          <span class="aia-name">${esc(s.name)}</span>${s.ex ? `<span class="aia-tag ok">موجود</span>` : `<span class="aia-tag">مورّد جديد</span>`}</div>
        ${s.ex ? "" : `<div class="aia-grid">
          <div><label>الاسم</label><input type="text" maxlength="120" data-s="name" data-i="${i}" value="${esc(s.name)}"></div>
          <div><label>الهاتف</label><input type="tel" dir="ltr" data-s="phone" data-i="${i}" value="${esc(s.phone)}" placeholder="07XXXXXXXX"></div>
          <div><label>ملاحظات</label><input type="text" maxlength="300" data-s="notes" data-i="${i}" value="${esc(s.notes)}"></div>
        </div>`}</div>`).join("");
    const matHtml = props.mats.map((m, i) => {
      const exTag = m.ex ? `<span class="aia-tag ok">موجودة — ${m.ex.kind === "ingredient" ? "ربط/بطاقة بس" : "ربط بالمورّد بس"}</span>` : `<span class="aia-tag">${KIND[m.kind]} جديد</span>`;
      const fields = m.ex ? "" : `
          <div><label>الاسم</label><input type="text" maxlength="120" data-m="name" data-i="${i}" value="${esc(m.name)}"></div>
          <div><label>النوع</label><select data-m="kind" data-i="${i}">${Object.keys(KIND).map((k) => `<option value="${k}"${k === m.kind ? " selected" : ""}>${KIND[k]}</option>`).join("")}</select></div>
          <div><label>وحدة المخزون</label><select data-m="unit" data-i="${i}">${UNITS.concat(UNITS.includes(m.unit) ? [] : [m.unit]).map((u) => `<option${u === m.unit ? " selected" : ""}>${esc(u)}</option>`).join("")}</select></div>
          <div><label>وحدة الشراء (اختياري)</label><input type="text" maxlength="30" data-m="pu" data-i="${i}" value="${esc(m.pu)}" placeholder="كرتونة، صندوق..."></div>
          <div><label>كم ${esc(m.unit)} فيها</label><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-m="pf" data-i="${i}" value="${esc(m.pf)}"></div>
          <div><label>الكمية الموجودة</label><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-m="stock" data-i="${i}" value="${esc(m.stock)}" placeholder="0"></div>
          <div><label>السعر</label><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-m="price" data-i="${i}" value="${esc(m.price)}" placeholder="—"></div>
          <div><label>السعر لكل</label><select data-m="per" data-i="${i}"><option value="stock"${m.per === "stock" ? " selected" : ""}>${esc(m.unit)}</option>${m.pu ? `<option value="purchase"${m.per === "purchase" ? " selected" : ""}>${esc(m.pu)}</option>` : ""}</select></div>`;
      const cardFields = m.kind === "ingredient" ? `
          <div><label>بطاقة المنيو (اختياري)</label><input type="text" maxlength="80" data-m="card" data-i="${i}" value="${esc(m.card)}" placeholder="مثلًا: مشروب غازي علبة"></div>
          <div><label>اسم النوع بالبطاقة</label><input type="text" maxlength="80" data-m="variant" data-i="${i}" value="${esc(m.variant)}"></div>` : "";
      return `<div class="aia-item${m.on ? "" : " off"}">
        <div class="aia-head"><input type="checkbox" data-m-on="${i}"${m.on ? " checked" : ""} aria-label="تحديد"><span class="aia-name">${esc(m.name)}</span>${exTag}</div>
        <div class="aia-grid">${fields}
          <div><label>المورّد</label><select data-m="sup" data-i="${i}">${supOptions(m.sup)}</select></div>${cardFields}
        </div></div>`;
    }).join("");
    const nSel = props.sups.filter((s) => s.on && !s.ex).length + props.mats.filter((m) => m.on).length;
    box.innerHTML = (props.sups.length ? `<div class="aia-sec"><h3>الموردين</h3>${supHtml}</div>` : "")
      + (props.mats.length ? `<div class="aia-sec"><h3>المواد والمستلزمات</h3>${matHtml}</div>` : "")
      + `<div class="aia-row" style="margin-top:14px;"><button type="button" class="btn gold" id="aia-apply"${nSel ? "" : " disabled"}>إضافة المحدد (${nSel})</button>
         <span class="hint" style="margin:0;">البطاقات بتنحفظ على المادة؛ عرضها بالمنيو بيضل من صفحة «المنيو من المخزون».</span></div>`;

    box.querySelectorAll("[data-s-on]").forEach((el) => el.addEventListener("change", () => { props.sups[+el.dataset.sOn].on = el.checked; renderReview(back); }));
    box.querySelectorAll("[data-m-on]").forEach((el) => el.addEventListener("change", () => { props.mats[+el.dataset.mOn].on = el.checked; renderReview(back); }));
    box.querySelectorAll("[data-s]").forEach((el) => el.addEventListener("input", () => {
      const s = props.sups[+el.dataset.i], old = "new:" + norm(s.name);
      s[el.dataset.s] = el.value;
      if (el.dataset.s === "name") props.mats.forEach((m) => { if (m.sup === old) m.sup = "new:" + norm(s.name); });
    }));
    box.querySelectorAll("[data-s=name]").forEach((el) => el.addEventListener("change", () => renderReview(back)));
    box.querySelectorAll("[data-m]").forEach((el) => {
      const ev = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(ev, () => {
        const m = props.mats[+el.dataset.i], k = el.dataset.m;
        m[k] = el.value;
        if (k === "kind" && m.kind !== "ingredient") { m.card = ""; m.variant = ""; }
        if (k === "kind" || k === "unit") renderReview(back);
      });
      if (el.dataset.m === "pu") el.addEventListener("change", () => renderReview(back));
    });
    const apply = box.querySelector("#aia-apply");
    if (apply) apply.addEventListener("click", async () => {
      apply.disabled = true; back.querySelector("#aia-err").textContent = "";
      try {
        const msg = await applyAll();
        props = null;
        box.innerHTML = `<div class="aia-row" style="margin-top:14px;"><span class="aia-tag ok" style="font-size:14px;">✓ ${esc(msg)}</span><button type="button" class="btn gold" id="aia-done">تم</button></div>`;
        box.querySelector("#aia-done").addEventListener("click", () => location.reload());
        back.querySelector("#aia-text").value = "";
      } catch (err) {
        back.querySelector("#aia-err").textContent = err.message || String(err);
        renderReview(back);
      }
    });
  }

  async function applyAll() {
    const selSups = props.sups.filter((s) => s.on && !s.ex);
    const selMats = props.mats.filter((m) => m.on);
    // تحقق قبل أي كتابة
    for (const s of selSups) {
      s.name = clip(s.name, 120);
      if (s.name.length < 2) throw new Error("في مورّد بدون اسم");
      const bad = typeof olvPhoneProblem === "function" ? olvPhoneProblem(s.phone) : null;
      if (bad) throw new Error(`${s.name}: ${bad}`);
    }
    for (const m of selMats) {
      if (m.ex) continue;
      m.name = clip(m.name, 120);
      if (m.name.length < 2) throw new Error("في مادة بدون اسم");
      if (m.pu && !(Number(m.pf) > 0)) throw new Error(`${m.name}: حدد كم ${m.unit} بالـ${m.pu}`);
      if (m.stock !== "" && !(Number(m.stock) >= 0)) throw new Error(`${m.name}: الكمية غير صحيحة`);
      if (m.price !== "" && !(Number(m.price) >= 0)) throw new Error(`${m.name}: السعر غير صحيح`);
      const dup = existingByName(m.name, m.kind);
      if (dup) { m.ex = dup; m.kind = dup.kind; }
    }
    const done = { sup: 0, mat: 0, link: 0, card: 0 };
    // 1) الموردين الجدد
    const newSupId = new Map();
    for (const s of selSups) {
      const exS = suppliers.find((x) => norm(x.name) === norm(s.name));
      if (exS) { newSupId.set("new:" + norm(s.name), exS.id); continue; }
      const { data, error } = await sb.from("suppliers").insert({ name: s.name, phone: clip(s.phone, 30) || null, notes: clip(s.notes, 300) || null }).select("id, name");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      suppliers.push(row); s.ex = row; s.on = false;
      newSupId.set("new:" + norm(s.name), row.id); done.sup++;
    }
    const supOf = (m) => (m.sup && m.sup.startsWith("new:") ? newSupId.get(m.sup) || null : m.sup || null);
    // 2) المواد الجديدة، والربط بالمورّد
    const cardAssign = [];
    for (const m of selMats) {
      const supId = supOf(m);
      let row = m.ex;
      if (!row) {
        const pf = Number(m.pf) > 0 && m.pu ? Number(m.pf) : null;
        const price = m.price === "" ? null : Number(m.price) / (m.per === "purchase" && pf ? pf : 1);
        const payload = { name: m.name, unit: m.unit, current_stock: m.stock === "" ? 0 : Number(m.stock), low_stock_threshold: 0 };
        if (pf) { payload.purchase_unit = clip(m.pu, 30); payload.purchase_unit_factor = pf; }
        if (price != null && price > 0) payload.unit_price = Math.round(price * 100000) / 100000;
        if (m.kind === "supply") { payload.category = "عام"; payload.supplier_id = supId; }
        const { data, error } = await sb.from(m.kind === "ingredient" ? "ingredients" : "supplies").insert(payload).select("id, name, unit");
        if (error) throw new Error(`${m.name}: ${error.code === "23505" ? "الاسم موجود أصلًا" : error.message}`);
        row = Object.assign({ kind: m.kind, supplier_id: m.kind === "supply" ? supId : null }, Array.isArray(data) ? data[0] : data);
        (m.kind === "ingredient" ? ingredients : supplies).push(row);
        m.ex = row; done.mat++;
      }
      // مستلزم جديد مورّده انحفظ بعمود supplier_id نفسه (متل صفحة المستلزمات)، فما بيحتاج سطر ربط
      if (supId && !(row.kind === "supply" && row.supplier_id === supId)) {
        const { error } = await sb.from("supplier_items").insert({ supplier_id: supId, [row.kind === "ingredient" ? "ingredient_id" : "supply_id"]: row.id });
        if (error && error.code !== "23505") throw error;
        if (!error) done.link++;
      }
      if (row.kind === "ingredient" && clip(m.card, 80) && clip(m.card, 80) !== (row.menu_group || "")) {
        cardAssign.push({ id: row.id, group: clip(m.card, 80), variant: clip(m.variant, 80) || row.name });
      }
      m.on = false;
    }
    // 3) البطاقات
    if (cardAssign.length) {
      const { error } = await sb.rpc("set_menu_stock_cards", { p_assign: cardAssign });
      if (error) throw new Error("انضافت المواد بس فشل حفظ البطاقات: " + error.message);
      done.card = new Set(cardAssign.map((c) => c.group)).size;
    }
    const parts = [];
    if (done.sup) parts.push(`${done.sup} مورّد`);
    if (done.mat) parts.push(`${done.mat} مادة`);
    if (done.link) parts.push(`${done.link} ربط بمورّد`);
    if (done.card) parts.push(`${done.card} بطاقة`);
    return parts.length ? "انضاف: " + parts.join("، ") : "ما في شي جديد للإضافة";
  }
  function mount() {
    const wrap = document.querySelector(".wrap");
    if (!wrap || document.getElementById("aia-launch")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const bar = document.createElement("div");
    bar.className = "aia-launch"; bar.id = "aia-launch";
    bar.innerHTML = `<button type="button" class="btn gold" id="aia-open">✨ إضافة بالذكاء الاصطناعي</button><span class="hint" style="margin:0;">مواد، مستلزمات، موردين، وبطاقات منيو — من نص أو صورة</span>`;
    const err = wrap.querySelector(".err");
    if (err && err.parentNode === wrap) err.after(bar); else wrap.prepend(bar);
    bar.querySelector("#aia-open").addEventListener("click", open);
  }
  window.olvOpenAiAssist = open;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
