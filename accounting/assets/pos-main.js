    document.addEventListener("DOMContentLoaded", () => {
    olvRenderNav("pos");
    document.getElementById("search-icon").innerHTML = olvIcon("search");
    document.getElementById("discount-toggle-btn").innerHTML = olvIcon("tag") + "<span>إضافة خصم</span>";
    document.getElementById("reprint-open-btn").innerHTML = olvIcon("printer") + '<span class="btn-label">إعادة طباعة</span>';
    document.getElementById("reprint-open-btn").addEventListener("click", () => olvOpenReprintList());

    // ---------------------------------------------------------------
    // وجبة موظف: الكاشير بيختار موظف بصم اليوم + ساندويش + مشروب من القوائم المسموحة (الإعدادات).
    // بدون سعر ولا دفع؛ بتنطبع للمطبخ/البار بدون فاتورة. وجبة وحدة باليوم، وبعدها بموافقة مدير.
    // ---------------------------------------------------------------
    document.getElementById("staff-meal-btn").innerHTML = olvIcon("dish") + '<span class="btn-label">وجبة موظف</span>';
    document.getElementById("staff-meal-btn").addEventListener("click", () => openStaffMeal());
    async function openStaffMeal() {
      if (!navigator.onLine) { showToast("وجبة الموظف بتحتاج اتصال بالإنترنت", "var(--danger)", "warning"); return; }
      const db = window.supabaseClient;
      const fmtT = (iso) => new Date(iso).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" });
      const backdrop = document.createElement("div");
      backdrop.className = "checkout-backdrop";
      backdrop.innerHTML = `<div class="checkout-modal sm-modal" role="dialog" aria-modal="true" aria-label="وجبة موظف">
        <div class="checkout-head"><h2>وجبة موظف</h2><button type="button" class="checkout-close" aria-label="إغلاق">${olvIcon("x")}</button></div>
        <div id="sm-body"><p class="sm-empty">جاري التحميل...</p></div></div>`;
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add("in"));
      let busy = false;
      const close = () => { if (busy) return; backdrop.classList.remove("in"); setTimeout(() => backdrop.remove(), 170); };
      backdrop.querySelector(".checkout-close").addEventListener("click", close);
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
      const body = backdrop.querySelector("#sm-body");
      try {
        const [c, st] = await Promise.all([
          db.rpc("staff_meal_candidates"),
          db.from("app_settings").select("key, value").in("key", ["staff_meal_sandwiches", "staff_meal_drinks"]),
        ]);
        if (c.error) throw c.error;
        const cfg = {};
        (st.data || []).forEach((r) => { cfg[r.key] = String(r.value || "").split(",").filter(Boolean); });
        const byId = new Map(products.map((p) => [p.id, p]));
        const pick = (key) => (cfg[key] || []).map((id) => byId.get(id)).filter(Boolean);
        const sandwiches = pick("staff_meal_sandwiches"), drinks = pick("staff_meal_drinks");
        const emps = c.data || [];
        if (!sandwiches.length || !drinks.length) {
          body.innerHTML = `<p class="sm-empty">قوائم وجبة الموظفين لسا مش محددة. المدير بيحددها من صفحة «وجبات الموظفين».</p>`
            + (window.olvRole && window.olvRole !== "staff" ? `<a class="btn gold checkout-confirm" href="staff-meals.html#items" style="display:flex;align-items:center;justify-content:center;margin-top:10px;">حدّد الأصناف هلأ</a>` : "");
          return;
        }
        let emp = null, sw = null, dr = null, needOverride = false, note = "";
        const ref = (crypto.randomUUID && crypto.randomUUID()) || null;
        const chips = (list, sel, attr, extra) => list.map((x) =>
          `<button type="button" class="sm-chip${sel === x.id ? " on" : ""}${extra ? extra(x) : ""}" data-${attr}="${x.id}">${olvEsc(x.name || x.full_name)}${x.meal_at ? `<small>استلم ${fmtT(x.meal_at)}</small>` : ""}</button>`).join("");
        function render() {
          body.innerHTML = `
            <div class="sm-sec">الموظف (اللي بصم اليوم)</div>
            ${emps.length ? `<div class="sm-grid">${chips(emps, emp, "emp", (x) => (x.meal_at ? " done" : ""))}</div>` : `<p class="sm-empty">ما حدا بصم اليوم لسا</p>`}
            <div class="sm-sec">الساندويش</div><div class="sm-grid">${chips(sandwiches, sw, "sw")}</div>
            <div class="sm-sec">المشروب</div><div class="sm-grid">${chips(drinks, dr, "dr")}</div>
            ${note ? `<div class="sm-note">${olvEsc(note)}</div>` : ""}
            <button type="button" class="btn gold checkout-confirm" id="sm-go" style="margin-top:16px;" ${emp && sw && dr ? "" : "disabled"}>${needOverride ? "وجبة ثانية بموافقة المدير" : "تسجيل الوجبة"}</button>`;
          body.querySelectorAll("[data-emp]").forEach((b) => b.addEventListener("click", () => { emp = b.dataset.emp; needOverride = false; note = ""; render(); }));
          body.querySelectorAll("[data-sw]").forEach((b) => b.addEventListener("click", () => { sw = b.dataset.sw; render(); }));
          body.querySelectorAll("[data-dr]").forEach((b) => b.addEventListener("click", () => { dr = b.dataset.dr; render(); }));
          body.querySelector("#sm-go").addEventListener("click", submit);
        }
        async function submit() {
          const go = body.querySelector("#sm-go");
          go.disabled = true; busy = true;
          try {
            if (needOverride && window.olvRole === "staff") {
              const pin = await olvAskManagerPin("discount");
              if (!pin) { busy = false; render(); return; }
              const { data: ok, error: ae } = await db.rpc("request_approval", { p_pin: pin, p_kind: "discount" });
              if (ae) throw ae;
              if (!ok) throw new Error("رمز المدير غلط");
            }
            const { data, error } = await db.rpc("record_staff_meal", { p_profile_id: emp, p_sandwich_id: sw, p_drink_id: dr, p_client_ref: ref, p_override: needOverride });
            if (error) throw error;
            const who = emps.find((x) => x.id === emp);
            if (typeof OlvSound !== "undefined") OlvSound.playSuccess();
            busy = false; close();
            showToast(`تم تسجيل وجبة ${who ? who.full_name : ""}${data && data.order_no ? " — طلب " + data.order_no : ""}`, "var(--ok)", "check");
          } catch (err) {
            busy = false;
            const m = String((err && err.message) || "");
            if (/استلم وجبته/.test(m)) { needOverride = true; note = m + " — وجبة ثانية بتحتاج موافقة المدير."; }
            else if (/record_staff_meal|staff_meal_candidates/.test(m) && /function|schema cache/i.test(m)) note = "وجبة الموظفين لسا ما تفعّلت بقاعدة البيانات";
            else note = olvIsNetworkError(err) ? "تعذّر الاتصال بالإنترنت — الوجبة ما انسجّلت" : m || "صار خطأ";
            if (typeof OlvSound !== "undefined") OlvSound.playError();
            render();
          }
        }
        render();
      } catch (err) {
        body.innerHTML = `<div class="sm-note">${olvEsc((err && err.message) || "تعذّر التحميل")}</div>`;
      }
    }
    document.getElementById("discount-remove-btn").innerHTML = olvIcon("x");

    // يحسب ارتفاع الشريط العلوي فعليًا (يتغيّر حسب حجم الشاشة) ويخزّنه
    // كمتغيّر CSS، حتى تبدأ التذكرة والقائمة مباشرة تحته بدون أي فراغ
    function updateNavHeight() {
      const nav = document.getElementById("olv-nav");
      const hidden = document.body.classList.contains("pos-focus");
      if (nav) document.documentElement.style.setProperty("--nav-h", (hidden ? 0 : nav.offsetHeight) + "px");
    }
    updateNavHeight();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateNavHeight);

    // ---- وضع ملء الشاشة: الشريط العلوي/السفلي مخفي، بيطلع بزر أو بسحبة من حافة الشاشة ----
    // الاختيار محفوظ لكل جهاز. افتراضيًا شغّال (الكاشير بده أكبر مساحة للأصناف)
    const FOCUS_KEY = "olv_pos_focus_v1";
    const catAside = document.querySelector(".pos-cat-sidebar");
    const posLayout = document.querySelector(".pos-layout");
    const posMain = document.querySelector(".pos-main");
    let focusOn = true;
    try { focusOn = localStorage.getItem(FOCUS_KEY) !== "off"; } catch (_) {}
    function setNavOpen(open) {
      document.body.classList.toggle("pos-nav-open", open && focusOn);
    }
    function placeCategories() {
      // كمبيوتر + وضع كامل: التصنيفات بتنتقل لفوق الأصناف كشريط شرائح؛ غير هيك مكانها الأصلي
      const wide = window.matchMedia("(min-width:901px)").matches;
      if (focusOn && wide) {
        if (catAside.parentElement !== posMain) posMain.insertBefore(catAside, document.getElementById("products-grid"));
      } else if (catAside.parentElement !== posLayout) {
        posLayout.insertBefore(catAside, posLayout.firstChild);
      }
    }
    function setFocus(on, save) {
      focusOn = on;
      document.body.classList.toggle("pos-focus", on);
      if (!on) document.body.classList.remove("pos-nav-open");
      if (save) { try { localStorage.setItem(FOCUS_KEY, on ? "on" : "off"); } catch (_) {} }
      const t = document.getElementById("focus-toggle-btn");
      t.innerHTML = olvIcon(on ? "minimize" : "maximize") + `<span class="btn-label">${on ? "إظهار القوائم" : "ملء الشاشة"}</span>`;
      t.title = on ? "رجّع الشريط العلوي والسفلي دايمًا" : "خبّي الشريط العلوي والسفلي";
      placeCategories();
      updateNavHeight();
      if (typeof updatePosHeight === "function") updatePosHeight();
      if (products.length) renderGrid();
    }
    document.getElementById("pos-edge-handle").innerHTML = olvIcon("chevronDown");
    document.getElementById("pos-edge-handle").addEventListener("click", () => setNavOpen(true));
    document.getElementById("pos-nav-backdrop").addEventListener("click", () => setNavOpen(false));
    document.getElementById("focus-toggle-btn").addEventListener("click", () => setFocus(!focusOn, true));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("pos-nav-open")) setNavOpen(false); });
    // سحبة من أعلى الشاشة لتحت = إظهار القوائم؛ سحبة لفوق على القوائم = إخفاءها
    let swipe = null;
    document.addEventListener("touchstart", (e) => {
      if (!focusOn || e.touches.length !== 1) return;
      const t = e.touches[0];
      const open = document.body.classList.contains("pos-nav-open");
      if (!open && t.clientY <= 28) swipe = { y: t.clientY, open: false };
      else if (open && (t.clientY <= 140 || t.clientY >= window.innerHeight - 90)) swipe = { y: t.clientY, open: true, bottom: t.clientY >= window.innerHeight - 90 };
      else swipe = null;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!swipe) return;
      const dy = e.touches[0].clientY - swipe.y;
      if (!swipe.open && dy > 36) { setNavOpen(true); swipe = null; }
      else if (swipe.open && (swipe.bottom ? dy > 36 : dy < -36)) { setNavOpen(false); swipe = null; }
    }, { passive: true });
    document.addEventListener("touchend", () => { swipe = null; }, { passive: true });

    // نفس فكرة updateNavHeight بس للشريط السفلي — يختفي بالموبايل
    // (display:none)، فبيرجع ارتفاعه صفر تلقائيًا بدون أي كود إضافي
    function updateStatusBarHeight() {
      const bar = document.getElementById("pos-status-bar");
      if (bar) document.documentElement.style.setProperty("--status-h", bar.offsetHeight + "px");
    }
    updateStatusBarHeight();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateStatusBarHeight);

    // ارتفاع الشاشة الفعلي بالكمبيوتر = النافذة - (أي شي فوق الشبكة: شريط النت/التنقل) - الشريط السفلي.
    // لو تغيّر (ظهر/اختفى بانر النت، تغيّر حجم النافذة) منعيد الحساب ومنعيد توزيع الأصناف
    let lastPosH = 0;
    function updatePosHeight() {
      const layout = document.querySelector(".pos-layout");
      const bar = document.getElementById("pos-status-bar");
      if (!layout) return;
      const top = layout.getBoundingClientRect().top + window.scrollY;
      const h = Math.max(320, Math.floor(window.innerHeight - top - (bar ? bar.offsetHeight : 0)));
      document.documentElement.style.setProperty("--pos-h", h + "px");
      if (lastPosH && Math.abs(h - lastPosH) > 2 && typeof renderGrid === "function" && products.length) renderGrid();
      lastPosH = h;
    }
    updatePosHeight();
    // لما ينحمّل الخط بتتغيّر أطوال النصوص (وارتفاع البطاقات): منعيد القياس والتوزيع
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { updatePosHeight(); if (products.length) renderGrid(); });
    if (window.ResizeObserver) new ResizeObserver(updatePosHeight).observe(document.body);

    document.getElementById("psb-brand-icon").innerHTML = olvIcon("brand");

    // ساعة وتاريخ حيّين بأعلى شاشة بيع سريع — أرقام إنجليزية دايمًا
    // (numberingSystem: latn) بنفس قاعدة باقي البرنامج
    function updatePosClock() {
      const now = new Date();
      document.getElementById("pos-clock-time").textContent =
        now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
      document.getElementById("pos-clock-date").textContent =
        now.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric", numberingSystem: "latn" });
    }
    updatePosClock();
    setInterval(updatePosClock, 15000);

    // أيقونة خطوط ذهبية مناسبة للتصنيف — تُستخدم بتبويبات التصنيف
    // وكواجهة افتراضية أنيقة عند عدم توفر صورة حقيقية للصنف، بدل الإيموجي
    // الملوّن القديم يلي كان يكسر وحدة الشكل البصري جنب باقي أيقونات
    // البرنامج (الشريط العلوي، الأزرار) اللي كلها بنفس نمط الخطوط الذهبية
    function categoryIconName(category) {
      const c = category || "";
      const rules = [
        [/برغر|سندويش|شاورما/, "burger"],
        [/بطاطا|سناك|ناتشوز|أجنحة|وودجز/, "fries"],
        [/سلطة|سلطات|مقبلات|حمص|فتوش|مناقيش/, "salad"],
        [/قهوة|إسبريسو|كابتشينو|لاتيه|شاي|ساخن/, "coffee"],
        [/عصير|عصائر|سموذي|كوكتيل/, "cup"],
        [/بارد|موهيتو|ليموناضة|آيس/, "snowflake"],
        [/بوظة|آيس كريم|ميلك شيك/, "iceCream"],
        [/دونات/, "donut"],
        [/كيك|تشيز كيك|تيراميسو|حلويات/, "cake"],
        [/أرجيلة|نكهات|شيشة/, "shisha"],
        [/إضاف/, "plus"],
        [/مشروبات/, "cup"],
      ];
      for (const [pattern, icon] of rules) {
        if (pattern.test(c)) return icon;
      }
      return "dish";
    }

    // صورة مؤقتة مطابقة لاسم/تصنيف الصنف (ريثما يرفع صاحب المطعم صورة
    // حقيقية من صفحة الإعدادات). لو الصورة ما اشتغلت (رابط معطّل) بيرجع
    // تلقائيًا لأيقونة التصنيف عبر olvHandleImageError
    function productPhotoUrl(name, category) {
      const text = `${name || ""} ${category || ""}`;
      const rules = [
        [/برغر|هامبرغر/, "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=60"],
        [/بيتزا/, "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=400&q=60"],
        [/دجاج/, "https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=400&q=60"],
        [/كباب|مشوي|مشاوي|لحم/, "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=400&q=60"],
        [/مكرونة|باستا/, "https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=400&q=60"],
        [/سندويش|شاورما|راب/, "https://images.unsplash.com/photo-1553909489-cd47e0ef937f?auto=format&fit=crop&w=400&q=60"],
        [/سلطة|مقبلات|حمص|فتوش/, "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=400&q=60"],
        [/بطاطا|سناك|أجنحة|وودجز/, "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=400&q=60"],
        [/قهوة|إسبريسو|كابتشينو|لاتيه/, "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=400&q=60"],
        [/كيك|تشيز كيك|تيراميسو|حلويات|بوظة|آيس كريم/, "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=400&q=60"],
      ];
      for (const [pattern, url] of rules) {
        if (pattern.test(text)) return url;
      }
      return null;
    }

    window.olvHandleImageError = function (img) {
      const fallback = document.createElement("div");
      fallback.className = "thumb-fallback";
      fallback.innerHTML = olvIcon(img.dataset.fallbackIcon || "dish");
      img.replaceWith(fallback);
    };

    // إشعار مؤقت يظهر أسفل الشاشة (نجاح بيع، أو تنبيه طلب جاهز)، بما إن
    // الشاشة بقيت مفتوحة على بيع سريع نفسها بدل الانتقال لصفحة منفصلة
    function showToast(msg, color, icon) {
      const type = color === "var(--danger)" ? "danger" : color === "var(--gold-dp)" ? "gold" : "ok";
      olvToast(msg, { type, icon, ms: 2200 });
    }

    // يراقب الطلبات اليوم اللي صارت "جاهز" (المطبخ صار خلص فيها) ويطلع
    // صوت تنبيه + إشعار للكاشير — يتجاهل الطلبات الجاهزة أصلًا وقت فتح
    // الشاشة، وينبّه بس على اللي بيصير جاهز جديد بعدها
    let knownReadyIds = null; // null = لسا ما انعمل الأساس (baseline) الأول
    async function checkForReadyOrders() {
      const { data, error } = await window.supabaseClient
        .from("sales_entries")
        .select("id, order_type")
        .eq("kitchen_status", "جاهز")
        .eq("entry_date", olvToday())
        .eq("status", "completed")
        .limit(60);
      if (error) return;
      const currentIds = new Map((data || []).map((o) => [o.id, o]));
      if (knownReadyIds === null) {
        knownReadyIds = new Set(currentIds.keys());
        return;
      }
      const newOnes = [];
      currentIds.forEach((order, id) => { if (!knownReadyIds.has(id)) newOnes.push(order); });
      knownReadyIds = new Set(currentIds.keys());
      if (newOnes.length) {
        OlvSound.playOrderReady();
        newOnes.forEach((order) => {
          showToast(`طلب ${order.order_type || ""} جاهز من المطبخ`, "var(--gold-dp)", "checkCircle");
        });
      }
    }

    let session = null;
    let products = [];
    let addons = [];
    // الأرجيلة: بدل الإضافات بيختار الكاشير النكهة (app_settings.hookah_flavors مفصولة بـ |)
    let hookahFlavors = [];
    let hookahStock = []; // أسماء المعسل من المخزون («معسل مزايا نعناع»)
    // نكهات الصنف: من المخزون حسب ماركة الأرجيلة (مزايا/نخلة...)، وإذا ما لقينا بنرجع للقائمة اليدوية
    function flavorsFor(item) {
      const brand = (item.name || "").replace(/^[أا]رجيلة\s*/, "").trim();
      const words = brand.split(/\s+/).filter((w) => w.length > 2);
      let list = hookahStock.filter((n) => words.some((w) => n.includes(w)));
      if (!list.length) list = hookahStock;
      if (!list.length) return hookahFlavors.map((f) => ({ label: f, value: f }));
      return list.map((n) => {
        let label = n.replace(/^معسل\s*/, "");
        words.forEach((w) => { label = label.replace(w, ""); });
        label = label.replace(/\s+/g, " ").trim() || n;
        return { label, value: label };
      }).sort((a, b) => a.label.localeCompare(b.label, "ar"));
    }
    // نكهات الأكل (بطاقة المادة → products.flavors مفصولة بـ |): اختيار واحد إجباري
    const prodFlavors = (p) => (p && p.flavors ? String(p.flavors).split("|").map((x) => x.trim()).filter(Boolean) : []);
    const isHookah = (cat) => /[أا]رجيل/.test(cat || "");
    // الإضافات لازم تنطبق على المنطق: الجبنة مثلًا بس للأكل المالح (مش للمشروبات ولا الحلويات)
    const SAVORY_CAT = /برغر|ساندويش|سناك|بيتزا|معجنات|باستا|عروض/;
    const addonFits = (a, cat) => !/جبن/.test(a.name || "") || SAVORY_CAT.test(cat || "");
    const itemCat = (item) => item.category || (window.olvCategoryOf && window.olvCategoryOf(item.productId));
    const flavorPrefix = "نكهة: ";
    // ساندويش | وجبة | وجبة دبل (OlvMeal): السعر بيتخزن على المنتج ويتعدّل يدويًا من الكاشير
    const mealAddonFor = (item, kind) => {
      const p = products.find((x) => x.id === item.productId);
      const id = p && p[OlvMeal.KINDS[kind].addon];
      return id ? addons.find((a) => a.id === id) || null : null;
    };
    const mealOk = (item) => !isHookah(itemCat(item)) && OlvMeal.eligible(products.find((x) => x.id === item.productId));
    const mealKindOf = (item) => (["double", "meal"].find((k) => { const a = mealAddonFor(item, k); return a && item.addons.some((x) => x.id === a.id); })) || "";
    // الأحجام: إضافة «وسط» وإضافة «كبير» خاصة بالصنف (بتتولّد من المنيو/البطاقة، سعرها = فرق السعر عن الصغير)؛ الصغير = بدونهم.
    // الوسط والكبير بيستبعدوا بعض (حجم واحد فقط بالسطر)
    const SIZE_FIELDS = { medium: "medium_addon_id", large: "large_addon_id" };
    const sizeAddonFor = (item, kind = "large") => {
      const p = products.find((x) => x.id === item.productId);
      const id = p && p[SIZE_FIELDS[kind]];
      return id ? addons.find((a) => a.id === id) || null : null;
    };
    const sizeKinds = (item) => ["medium", "large"].filter((k) => sizeAddonFor(item, k));
    const sizeKindOf = (item) => sizeKinds(item).find((k) => item.addons.some((x) => x.id === sizeAddonFor(item, k).id)) || "";
    // kind: "" (صغير) | "medium" | "large"
    function setSizeKind(idx, kind) {
      const item = OlvCart.all()[idx];
      if (!item) return;
      const sizeIds = sizeKinds(item).map((k) => sizeAddonFor(item, k).id);
      const a = kind ? sizeAddonFor(item, kind) : null;
      if (kind && !a) return;
      const rest = item.addons.filter((x) => !sizeIds.includes(x.id));
      OlvCart.updateAt(idx, { addons: a ? [...rest, { id: a.id, name: a.name, price: Number(a.price) }] : rest });
      olvHaptic();
      renderCart();
    }
    // «مع ثلج» للمشروبات الباردة (بدون تسعير): بتنكتب بملاحظة الصنف فبتطلع على تذكرة البار والفاتورة
    const ICE = "مع ثلج";
    const iceOk = (item) => /مشروبات باردة|كوكتيل|عصائر|ميلك شيك|ميلكشيك|سموذي|موهيتو/.test(itemCat(item) || "");
    const noteParts = (item) => String(item.note || "").split(" - ").map((x) => x.trim()).filter(Boolean);
    const hasIce = (item) => noteParts(item).includes(ICE);
    function setIce(idx, on) {
      const item = OlvCart.all()[idx];
      if (!item) return;
      const rest = noteParts(item).filter((x) => x !== ICE);
      OlvCart.updateAt(idx, { note: (on ? [ICE, ...rest] : rest).join(" - ") });
      olvHaptic();
      renderCart();
    }
    function setMealKind(idx, kind) {
      const item = OlvCart.all()[idx];
      if (!item) return;
      const strip = item.addons.filter((x) => !["meal", "double"].some((k) => { const a = mealAddonFor(item, k); return a && a.id === x.id; }));
      if (!kind) { OlvCart.updateAt(idx, { addons: strip }); olvHaptic(); renderCart(); return; }
      const a = mealAddonFor(item, kind);
      if (!a) { askMealPrice(idx, kind); return; }
      OlvCart.updateAt(idx, { addons: [...strip, { id: a.id, name: a.name, price: Number(a.price) }] });
      olvHaptic();
      renderCart();
    }
    // نافذة صغيرة لإدخال/تعديل سعر الوجبة الإجمالي يدويًا
    function askMealPrice(idx, kind) {
      const item = OlvCart.all()[idx];
      const p = item && products.find((x) => x.id === item.productId);
      if (!p) return;
      const k = OlvMeal.KINDS[kind];
      const backdrop = document.createElement("div");
      backdrop.className = "sheet-backdrop";
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.innerHTML = `
        <div class="sheet-grabber" aria-hidden="true"></div>
        <h2 style="margin-bottom:6px;">${olvEsc(k.label)} — ${olvEsc(p.name)}</h2>
        <div class="hint" style="margin-bottom:10px;">سعر الصنف لحاله ${olvFormatMoney(p.price)}. اكتب سعر ${olvEsc(k.label)} الإجمالي (بيتحفظ للمرات الجاية وبتقدر تعدّله).</div>
        <div class="field"><input type="number" inputmode="decimal" step="0.05" min="0" id="meal-total" placeholder="مثال: 3.50" value="${p[k.price] || ""}"></div>
        <button class="btn gold" id="meal-ok" style="width:100%;">تأكيد</button>
        <button class="btn" id="meal-cancel" style="width:100%; margin-top:8px;">إلغاء</button>`;
      const close = () => { backdrop.remove(); sheet.remove(); };
      backdrop.addEventListener("click", close);
      sheet.querySelector("#meal-cancel").addEventListener("click", close);
      sheet.querySelector("#meal-ok").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const total = Number(sheet.querySelector("#meal-total").value || 0);
        if (!(total > 0)) { sheet.querySelector("#meal-total").focus(); return; }
        btn.disabled = true;
        try {
          const { addon } = await OlvMeal.save(p, kind, total);
          const at = addons.findIndex((a) => a.id === addon.id);
          if (at >= 0) addons[at] = addon; else addons.push(addon);
          saveMenuCache();
          close();
          setMealKind(idx, kind);
        } catch (err) {
          btn.disabled = false;
          olvToast(err.message || "ما انحفظ سعر الوجبة — تأكد من النت");
        }
      });
      document.body.appendChild(backdrop);
      document.body.appendChild(sheet);
      sheet.querySelector("#meal-total").focus();
    }
    let popularity = {}; // product_id -> إجمالي الكمية المباعة تاريخيًا
    let activeCategory = "الكل";
    let searchTerm = "";
    let currentPage = 1;
    setFocus(focusOn, false); // تطبيق الوضع المحفوظ بعد ما تتعرّف المتغيرات
    const BEST_SELLERS = "الأكثر مبيعًا";
    const DRAFT_KEY = "olv_pos_draft";
    // تحديث البرنامج بيصير لحاله بس والتذكرة فاضية (olvWatchUpdates بـ layout.js)
    window.olvAutoReload = () => OlvCart.all().length === 0 && !document.querySelector(".checkout-backdrop, .sheet-backdrop, .olv-modal-backdrop");
    let discountMode = "percent"; // "percent" أو "fixed"
    let discountValue = 0;
    // بدل التوصيل: مبلغ ثابت بيتضاف على الإجمالي لطلبات سفري/توصيل بس (مش خصم ولا صنف: ما بيأثر على المخزون أو المطبخ)
    let deliveryFee = 0;
    function currentFee() {
      const t = document.getElementById("order-type").value;
      return (t === "سفري" || t === "توصيل") && deliveryFee > 0 ? Math.round(deliveryFee * 100) / 100 : 0;
    }
    function setDeliveryFee(v) {
      v = Math.round(Math.min(Math.max(Number(v) || 0, 0), 50) * 100) / 100;
      deliveryFee = v;
      const inp = document.getElementById("fee-input");
      const isChip = [0, 1, 1.5, 2].includes(v);
      document.querySelectorAll("#fee-chips button").forEach((b) => b.classList.toggle("on", Number(b.dataset.fee) === v));
      if (isChip) inp.value = ""; else inp.value = v;
      if (typeof renderCart === "function") renderCart();
    }

    // يحسب قيمة الخصم الفعلية بالعملة، مع سقف بحيث ما يتعدى المجموع الفرعي
    // (يمنع رقم خصم سالب أو إجمالي سالب بأي حال)
    // الكاشير عليه سقف خصم يفرضه السيرفر (staff_max_discount_percent) — هون
    // بنطبّقه كمان بالشاشة حتى ما يكتشف الكاشير الرفض بعد ما يجهّز الطلب
    let staffMaxDiscountPct = null;
    function computeDiscountAmount(subtotal) {
      if (!discountValue || discountValue <= 0) return 0;
      let raw = discountMode === "percent" ? subtotal * (discountValue / 100) : discountValue;
      if (staffMaxDiscountPct !== null) raw = Math.min(raw, subtotal * staffMaxDiscountPct / 100);
      return Math.round(Math.max(0, Math.min(raw, subtotal)) * 100) / 100;
    }

    // اقتراحات رقم الطاولة من قائمة الطاولات (الكاشير بيقدر يكتب غيرها). صفحة الطاولات بتعرف إنها
    // مشغولة من الطلب نفسه، فما في داعي نعلّمها من هون
    async function loadTableOptions() {
      try {
        const { data } = await window.supabaseClient.from("restaurant_tables").select("table_number").order("sort_order");
        document.getElementById("table-options").innerHTML = (data || [])
          .map((t) => `<option value="${olvEsc(olvNormTable(t.table_number))}"></option>`).join("");
      } catch (e) { /* اقتراحات بس */ }
    }

    // جاي من صفحة الطاولات («طلب جديد» / «زيد طلب» / حجز «وصلوا»): صالة + رقم الطاولة و/أو اسم الزبون معبّايين
    function applyTableFromLink() {
      const q = new URLSearchParams(location.search);
      const table = olvNormTable(q.get("table"));
      if (!table && !q.get("name")) return;
      document.getElementById("order-type").value = "صالة";
      updateOrderTypeFields();
      if (table) document.getElementById("table-number").value = table.slice(0, 30);
      updateTabBtn();
      const name = (q.get("name") || "").trim();
      if (name && !document.getElementById("customer-name").value.trim()) document.getElementById("customer-name").value = name.slice(0, 60);
      history.replaceState(null, "", location.pathname);
    }

    function resetDiscount() {
      deliveryFee = 0;
      document.getElementById("fee-input").value = "";
      document.querySelectorAll("#fee-chips button").forEach((b) => b.classList.toggle("on", b.dataset.fee === "0"));
      discountMode = "percent";
      discountValue = 0;
      document.getElementById("discount-value-input").value = "";
      document.getElementById("discount-form").hidden = true;
      document.getElementById("discount-toggle-btn").classList.remove("active");
      document.querySelectorAll(".discount-mode-tab").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.discountMode === "percent");
      });
    }

    // يحسب عدد الأعمدة/الصفوف اللي بتتسع فعليًا داخل الشاشة المفتوحة حاليًا
    // بدون سكرول، عشان باقي الأصناف تتوزع على صفحات بدل ما تتزاحم أو تختفي
    // ارتفاع البطاقة الحقيقي بيتقاس بعد الرسم (يختلف حسب العرض وطول الأسماء)؛
    // قبله منستعمل تقدير، وبعد الرسم renderGrid بيتأكد إنو الشبكة ما طلعت من المكان
    // المتاح وما بقي فيها مكان لصف زيادة، وبيعدّل عدد الصفوف (3 محاولات كحد أقصى)
    let measuredCardH = 0;
    const GRID_GAP = 14;
    // أقصى عدد أصناف بالصفحة الوحدة؛ الباقي بصفحات مرقّمة تحت الشبكة (بالموبايل والكمبيوتر)
    const MAX_PER_PAGE = 16;
    function gridAvailableHeight(grid) {
      // بالكمبيوتر العمود الأوسط بارتفاع ثابت: المتاح = ارتفاعه - مكان الشبكة داخله - أزرار الصفحات.
      // بالموبايل الصفحة بتتمرّر عادي فمنخلي مساحة مريحة تحت الشبكة
      const desktop = window.matchMedia("(min-width:901px)").matches;
      if (desktop) {
        const main = grid.closest(".pos-main");
        return main.clientHeight - (grid.getBoundingClientRect().top - main.getBoundingClientRect().top) - 58;
      }
      return window.innerHeight - (grid.getBoundingClientRect().top + window.scrollY) - 56;
    }
    // عدد الصفوف: بالكمبيوتر منقرّب لأقرب عدد صحيح والبطاقات بتتمدّد/بتصغر شوي (لحد 80%)
    // عشان الشبكة تملا الارتفاع؛ بالموبايل الصفحة بتتمرّر فمنقرّب لتحت
    function pickRows(avail, h, desktop) {
      if (!desktop) return Math.max(1, Math.floor((avail + GRID_GAP) / (h + GRID_GAP)));
      let r = Math.max(1, Math.round((avail + GRID_GAP) / (h + GRID_GAP)));
      if (r > 1 && (avail - GRID_GAP * (r - 1)) / r < h * 0.8) r--;
      return r;
    }
    function computeGridCapacity(rowsOverride) {
      const grid = document.getElementById("products-grid");
      const containerWidth = grid.clientWidth || 300;
      // 136 بملء الشاشة: التذكرة صارت أعرض (2026-10-28) وبدنا نضل 6 أعمدة على شاشة 1366
      const targetCardWidth = document.body.classList.contains("pos-focus") ? 136 : 165;
      const columns = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (targetCardWidth + GRID_GAP)));
      const cardWidth = (containerWidth - (columns - 1) * GRID_GAP) / columns;
      const cardHeight = measuredCardH || (cardWidth * 0.75 + 88);
      const availableHeight = Math.max(cardHeight, gridAvailableHeight(grid));
      const rows = rowsOverride || pickRows(availableHeight, cardHeight, window.matchMedia("(min-width:901px)").matches);
      return { columns, itemsPerPage: Math.min(columns * rows, MAX_PER_PAGE) };
    }

    function sortByPopularity(list) {
      return list.slice().sort((a, b) => {
        const pa = popularity[a.id] || 0;
        const pb = popularity[b.id] || 0;
        if (pb !== pa) return pb - pa;
        const sa = a.sort_order || 0;
        const sb = b.sort_order || 0;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, "ar");
      });
    }

    // نفس الأقسام الأربعة تبع منيو الزبون؛ التصنيف اللي مش معروف بينحط بـ«المزيد»
    const CAT_GROUPS = [
      { id: "offers", name: "عروض", cats: ["عروض"], icon: "tag" },
      { id: "food", name: "الأكل", cats: ["برغر", "سناكات", "ساندويشات", "ساندويشات الصباح", "بيتزا", "باستا", "سلطات"], icon: "burger" },
      { id: "drinks", name: "المشروبات", cats: ["مشروبات ساخنة", "مشروبات باردة", "كوكتيل", "عصائر", "ميلك شيك"], icon: "cup" },
      { id: "sweet", name: "الحلو", cats: ["حلويات", "بوظة", "دونات", "وافل", "كريب"], icon: "cake" },
      { id: "shisha", name: "الأرجيلة", cats: ["أرجيلة"], icon: "shisha" },
    ];
    function liveGroups() {
      const present = new Set(products.map((p) => p.category));
      const known = new Set(CAT_GROUPS.flatMap((g) => g.cats));
      const groups = CAT_GROUPS.map((g) => ({ ...g, cats: g.cats.filter((c) => present.has(c)) }));
      const extra = [...present].filter((c) => c && !known.has(c)).sort((a, b) => a.localeCompare(b, "ar"));
      if (extra.length) groups.push({ id: "more", name: "المزيد", cats: extra, icon: "grid" });
      return groups.filter((g) => g.cats.length);
    }
    function groupOfActive(groups) {
      if (activeCategory.startsWith("g:")) return groups.find((g) => "g:" + g.id === activeCategory) || null;
      return groups.find((g) => g.cats.includes(activeCategory)) || null;
    }

    // لون ثابت لكل تصنيف (6 ألوان) من اسمه: تمييز بصري سريع بدون أي كلفة وقت
    function catHue(name) {
      let h = 0;
      const t = String(name || "");
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
      return h % 6;
    }
    function renderCategoryTabs() {
      const hasBestSellers = Object.keys(popularity).length > 0;
      const groups = liveGroups();
      const cur = groupOfActive(groups);
      const tabs = [
        { k: "الكل", t: "الكل", icon: olvIcon("grid"), on: activeCategory === "الكل" },
        ...(hasBestSellers ? [{ k: BEST_SELLERS, t: BEST_SELLERS, icon: olvIcon("star"), on: activeCategory === BEST_SELLERS }] : []),
        ...groups.map((g) => ({ k: "g:" + g.id, t: g.name, icon: olvIcon(g.icon), on: !!cur && cur.id === g.id })),
      ];
      document.getElementById("cat-tabs").innerHTML = tabs.map((c, i) => `
        <button class="cat-tab h${i % 6}${c.on ? " on" : ""}" data-cat="${olvEsc(c.k)}">
          <span class="cat-tab-icon">${c.icon}</span>
          <span class="cat-tab-label">${olvEsc(c.t)}</span>
        </button>
      `).join("");
      const sub = document.getElementById("cat-sub");
      if (cur) {
        sub.hidden = false;
        sub.innerHTML = [`<button class="cat-chip${activeCategory === "g:" + cur.id ? " on" : ""}" data-cat="g:${cur.id}">كل ${olvEsc(cur.name)}</button>`]
          .concat(cur.cats.map((c) => `<button class="cat-chip${activeCategory === c ? " on" : ""}" data-cat="${olvEsc(c)}">${olvEsc(c)}</button>`)).join("");
      } else {
        sub.hidden = true;
        sub.innerHTML = "";
      }
      document.querySelectorAll(".cat-tab, .cat-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeCategory = btn.dataset.cat;
          currentPage = 1;
          renderCategoryTabs();
          renderGrid();
        });
      });
    }

    function renderGrid(iter = 0, rowsOverride = 0, noUp = false) {
      const grid = document.getElementById("products-grid");
      const pagination = document.getElementById("pos-pagination");
      let list;
      if (activeCategory === "الكل") {
        list = sortByPopularity(products);
      } else if (activeCategory === BEST_SELLERS) {
        list = sortByPopularity(products.filter((p) => popularity[p.id])).slice(0, 12);
      } else if (activeCategory.startsWith("g:")) {
        const g = liveGroups().find((x) => "g:" + x.id === activeCategory);
        const cs = new Set(g ? g.cats : []);
        list = sortByPopularity(products.filter((p) => cs.has(p.category)));
      } else {
        list = sortByPopularity(products.filter((p) => p.category === activeCategory));
      }
      if (searchTerm) {
        list = list.filter((p) => p.name.toLowerCase().includes(searchTerm));
      }
      if (!list.length) {
        grid.innerHTML = `<div class="hint">لا توجد أصناف مطابقة. جرّب تصنيفًا آخر أو أضف منتجات من صفحة الإعدادات.</div>`;
        pagination.hidden = true;
        return;
      }

      const { columns, itemsPerPage } = computeGridCapacity(rowsOverride);
      const totalPages = Math.max(1, Math.ceil(list.length / itemsPerPage));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;
      // الأصناف كلها بصفحة وحدة بالطول (كمبيوتر وموبايل) وتتسكرول، بدل الصفحات المرقّمة، بحجم البطاقة الطبيعي
      const scrollMode = true;
      const pageItems = scrollMode ? list : list.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
      const gridSig = activeCategory + "|" + searchTerm;
      const keepScroll = renderGrid._sig === gridSig ? grid.scrollTop : 0;
      renderGrid._sig = gridSig;

      // أول ٣ أصناف الأكثر مبيعًا بتاخد شارة مميزة بأي تصنيف — إلا وهي
      // بالتبويب المخصص لهم أصلًا (تكرار بلا داعي هناك)
      const topSellerIds = activeCategory === BEST_SELLERS
        ? new Set()
        : new Set(
            Object.keys(popularity)
              .sort((a, b) => popularity[b] - popularity[a])
              .slice(0, 3)
          );

      grid.classList.remove("fit");
      grid.style.gridAutoRows = "";
      grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
      grid.innerHTML = pageItems.map((p) => {
        const fallbackIcon = categoryIconName(p.category);
        const hue = catHue(p.category);
        const src = OlvMenuProducts.imageUrl(p.image_url) || productPhotoUrl(p.name, p.category);
        return `
        <div class="card h${hue}" data-id="${p.id}" data-sound="add">
          <span class="q" aria-hidden="true"></span>
          ${topSellerIds.has(p.id) ? `<span class="best-badge">${olvIcon("star")}الأكثر طلبًا</span>` : ""}
          ${src
            ? `<img class="thumb" loading="lazy" decoding="async" src="${src}" alt="${olvEsc(p.name)}" data-fallback-icon="${fallbackIcon}" onerror="olvHandleImageError(this)">`
            : `<div class="thumb-fallback">${olvIcon(fallbackIcon)}</div>`
          }
          <div class="info">
            <div class="name" title="${olvEsc(p.name)}">${olvEsc(p.name)}</div>
            ${p.description ? `<div class="desc">${olvEsc(p.description)}</div>` : ""}
            <div class="info-bottom">
              <span class="price">${olvFormatMoney(Number(p.hall_price) > 0 && document.getElementById("order-type").value === "صالة" ? p.hall_price : p.price)}</span>
              <button type="button" class="add-btn" data-add="${p.id}" data-sound="add">+ أضف</button>
            </div>
          </div>
        </div>
      `;
      }).join("");
      grid.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("click", () => quickAddToCart(card.dataset.id));
      });
      grid.querySelectorAll(".add-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          quickAddToCart(btn.dataset.add);
        });
      });

      syncCardQty(false);
      // نتأكد إنو عدد الصفوف مناسب للمكان المتاح، وبعدها بالكمبيوتر منمدّد الصفوف لتملا الارتفاع بالضبط
      const rowsShown = Math.ceil(pageItems.length / columns);
      if (scrollMode) grid.scrollTop = keepScroll;
      if (!scrollMode && rowsShown && grid.offsetHeight) {
        const desktop = window.matchMedia("(min-width:901px)").matches;
        const natural = grid.offsetHeight;
        const avail = gridAvailableHeight(grid);
        // ارتفاع الكرت الفعلي من أول كرت (مش من ارتفاع الشبكة: الشبكة ممدّدة لآخر الشاشة، فلو الصفحة فيها صف واحد
        // بس كان بيطلع ارتفاع الكرت = ارتفاع الشاشة كله وبعدها الكروت بتتمدّد طويلة جدًا)
        const firstCard = grid.querySelector(".card");
        measuredCardH = firstCard && firstCard.offsetHeight
          ? firstCard.offsetHeight
          : (natural - GRID_GAP * (rowsShown - 1)) / rowsShown;
        if (iter < 3) {
          const want = pickRows(avail, measuredCardH, desktop);
          if (want < rowsShown) return renderGrid(iter + 1, want, true);
          if (!noUp && want > rowsShown && pageItems.length === itemsPerPage && itemsPerPage < MAX_PER_PAGE && list.length > itemsPerPage) {
            return renderGrid(iter + 1, want, false);
          }
        }
        if (desktop && pageItems.length === itemsPerPage) {
          const R = (avail - GRID_GAP * (rowsShown - 1)) / rowsShown;
          // سقف للتمديد: بدون سقف، لو الصفحة فيها صف واحد بس (مثلًا ٣ أصناف) الكرت بيتمدّد لكل ارتفاع الشاشة
          if (R >= measuredCardH * 0.75 && R <= measuredCardH * 1.4 && Math.abs(R - measuredCardH) > 1) {
            grid.classList.add("fit");
            grid.style.gridAutoRows = Math.floor(R) + "px";
          }
        }
      }
      pagination.hidden = scrollMode || totalPages <= 1;
      document.getElementById("page-info").textContent = `${currentPage} / ${totalPages}`;
      document.getElementById("page-prev").disabled = currentPage <= 1;
      document.getElementById("page-next").disabled = currentPage >= totalPages;
    }

    // ضغطة وحدة على أي صنف بالقائمة تضيفه مباشرة للتذكرة بكمية 1 بدون
    // أي نافذة — لو نفس الصنف "العادي" (بدون إضافات ولا ملاحظة) موجود
    // أصلًا بالتذكرة، بتزيد كميته بدل ما تعمل سطر مكرر
    function quickAddToCart(productId) {
      const product = products.find((p) => p.id === productId);
      if (!product) return;
      // لو في إضافات بالنظام: نضيف الصنف كسطر جديد ونفتح نافذة اختيار الإضافات فورًا
      // («إلغاء» بتخليه بدون إضافات، «حذف» بتشيله)
      if (addons.some((a) => !a.is_meal && !a.is_size && addonFits(a, product.category)) || (isHookah(product.category) && (hookahStock.length || hookahFlavors.length)) || prodFlavors(product).length) {
        OlvCart.add(product, [], 1, "");
        olvHaptic();
        renderCart();
        openItemSheet(OlvCart.all().length - 1);
        return;
      }
      const cart = OlvCart.all();
      const existingIdx = cart.findIndex(
        (item) => item.productId === productId && item.addons.length === 0 && !item.note
      );
      if (existingIdx >= 0) {
        OlvCart.incrementQtyAt(existingIdx, 1);
      } else {
        OlvCart.add(product, [], 1, "");
      }
      olvHaptic();
      renderCart();
    }

    // اهتزاز خفيف جدًا مع كل إضافة (أندرويد؛ الآيفون ما بيدعمه من المتصفح فبيتجاهله بهدوء)
    function olvHaptic() {
      try { if (navigator.vibrate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) navigator.vibrate(8); } catch (e) { /* مش مدعوم */ }
    }

    // فتح شاشة تخصيص سطر موجود بالتذكرة (الكمية، الإضافات، الملاحظة)،
    // وتحتها زر لحذف السطر بالكامل من السلة
    function openItemSheet(idx) {
      const item = OlvCart.all()[idx];
      if (!item) return;
      const backdrop = document.createElement("div");
      backdrop.className = "sheet-backdrop";
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      let qty = item.qty;
      const hookah = isHookah(itemCat(item));
      let flavor = (item.note || "").startsWith(flavorPrefix) ? (item.note.split(" - ")[0].slice(flavorPrefix.length)) : "";
      let note = flavor ? (item.note || "").split(" - ").slice(1).join(" - ") : (item.note || "");
      const flavorList = hookah ? flavorsFor(item) : prodFlavors(products.find((x) => x.id === item.productId)).map((f) => ({ label: f, value: f }));
      const flavorRequired = !hookah && flavorList.length > 0;
      const sheetAddons = hookah ? [] : addons.filter((a) => !a.is_meal && !a.is_size && addonFits(a, itemCat(item)));
      const selectedAddons = new Set(item.addons.map((a) => a.id));

      function render() {
        sheet.innerHTML = `
          <div class="sheet-grabber" aria-hidden="true"></div>
          <h2 style="margin-bottom:10px;">${olvEsc(item.name)}</h2>
          <div class="hint" style="margin-bottom:10px;">${olvFormatMoney(OlvCart.unitPrice(item))}</div>
          ${flavorList.length ? `
            <div class="flavor-grid" role="radiogroup" aria-label="النكهة">
              ${flavorList.map((f) => `<button type="button" class="flavor-chip${f.value === flavor ? " on" : ""}" data-flavor="${olvEsc(f.value)}">${olvEsc(f.label)}</button>`).join("")}
            </div>` : ""}
          ${sheetAddons.length ? `
            <div style="margin-bottom:10px;">
              ${sheetAddons.map((a) => `
                <label class="addon-row" for="addon-${a.id}">
                  <input type="checkbox" data-addon="${a.id}" id="addon-${a.id}" ${selectedAddons.has(a.id) ? "checked" : ""}>
                  <span class="addon-name">${olvEsc(a.name)}</span>
                  <span class="a-price">+${olvFormatMoney(a.price)}</span>
                </label>
              `).join("")}
            </div>
          ` : ""}
          <div class="qty-row">
            <button type="button" id="qty-minus">−</button>
            <div style="font-size:16px; min-width:24px; text-align:center;">${qty}</div>
            <button type="button" id="qty-plus">+</button>
          </div>
          <div class="field">
            <label>ملاحظة للمطبخ (اختياري)</label>
            <input type="text" id="item-note" placeholder="مثال: بدون بصل" value="${olvEsc(note)}">
          </div>
          <button class="btn gold" id="sheet-save" style="width:100%;">حفظ التعديلات</button>
          <button class="btn danger" id="sheet-delete" style="width:100%; margin-top:8px;">حذف من السلة</button>
          <button class="btn" id="sheet-cancel" style="width:100%; margin-top:8px;">إلغاء</button>
        `;
        sheet.querySelectorAll("[data-flavor]").forEach((b) => {
          b.addEventListener("click", () => {
            flavor = flavor === b.dataset.flavor ? "" : b.dataset.flavor;
            note = sheet.querySelector("#item-note").value;
            render();
          });
        });
        sheet.querySelectorAll("input[data-addon]").forEach((cb) => {
          cb.addEventListener("change", () => {
            if (cb.checked) selectedAddons.add(cb.dataset.addon);
            else selectedAddons.delete(cb.dataset.addon);
          });
        });
        sheet.querySelector("#qty-minus").addEventListener("click", () => { qty = Math.max(1, qty - 1); note = sheet.querySelector("#item-note").value; render(); });
        sheet.querySelector("#qty-plus").addEventListener("click", () => { qty += 1; note = sheet.querySelector("#item-note").value; render(); });
        sheet.querySelector("#sheet-cancel").addEventListener("click", dismiss);
        sheet.querySelector("#sheet-delete").addEventListener("click", () => {
          OlvCart.removeAt(idx);
          renderCart();
          close();
        });
        sheet.querySelector("#sheet-save").addEventListener("click", () => {
          if (flavorRequired && !flavor) { olvToast("اختار النكهة أول", { type: "gold", icon: "warning" }); return; }
          const chosenAddons = addons.filter((a) => selectedAddons.has(a.id));
          const typed = sheet.querySelector("#item-note").value.trim();
          const finalNote = [flavor ? flavorPrefix + flavor : "", typed].filter(Boolean).join(" - ");
          OlvCart.updateAt(idx, { qty, addons: hookah ? [] : chosenAddons, note: finalNote });
          renderCart();
          close();
        });
      }
      // التسكير بيرجع الورقة لتحت (نفس المسار اللي طلعت منه) قبل ما تنشال
      let closed = false;
      function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onEsc);
        sheet.classList.remove("dragging", "settling");
        sheet.classList.add("closing");
        backdrop.classList.add("closing");
        const remove = () => { backdrop.remove(); sheet.remove(); };
        sheet.addEventListener("animationend", remove, { once: true });
        setTimeout(remove, 400);
      }
      // صنف بنكهة إجبارية: لو انسكرت النافذة بدون اختيار نكهة بينشال السطر
      function dismiss() {
        if (flavorRequired && !(OlvCart.all()[idx] && (OlvCart.all()[idx].note || "").startsWith(flavorPrefix))) { OlvCart.removeAt(idx); renderCart(); }
        close();
      }
      function onEsc(e) { if (e.key === "Escape") dismiss(); }
      document.addEventListener("keydown", onEsc);
      backdrop.addEventListener("click", dismiss);
      olvAttachSwipeDismiss(sheet, backdrop, dismiss);
      render();
      document.body.appendChild(backdrop);
      document.body.appendChild(sheet);
    }

    // يظهر حقل رقم الطاولة لطلبات "صالة" فقط، وحقل رقم تلفون الزبون
    // لطلبات "توصيل" فقط، وحقل اسم الزبون لطلبات "صالة"/"سفري" (الاسم ورقم
    // الطاولة اختياريين — الطلب بينطبع بدونهم)، ويصفّر الحقل غير المستخدم حتى
    // ما تنتقل بيانات طلب سابق بالغلط لطلب من نوع مختلف
    function updateOrderTypeFields() {
      const type = document.getElementById("order-type").value;
      OlvCart.setMode(type);
      if (typeof renderGrid === "function" && products.length) renderGrid();
      if (typeof renderCart === "function") renderCart();
      document.querySelectorAll("#order-type-seg button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
      const tableField = document.getElementById("table-number-field");
      const nameField = document.getElementById("customer-name-field");
      tableField.hidden = type !== "صالة";
      nameField.hidden = type === "توصيل";
      if (type !== "صالة") document.getElementById("table-number").value = "";
      document.getElementById("fee-row").hidden = !(type === "سفري" || type === "توصيل");
      updateTabBtn();
      if (type === "توصيل") document.getElementById("customer-name").value = "";
      // حقل رقم الهاتف ظاهر دايمًا الآن (مش بس لطلبات التوصيل) — إجباري
      // لسا لطلبات التوصيل بس (نفس التحقق بالأسفل)، واختياري لباقي
      // الأنواع عشان يقدر الكاشير يسجّل نقاط ولاء حتى لزبون صالة/سفري
      document.getElementById("customer-phone-label").textContent =
        type === "توصيل" ? "رقم تلفون الزبون" : "رقم تلفون الزبون (اختياري — لبرنامج الولاء)";
      document.getElementById("customer-phone").placeholder = type === "توصيل" ? "تلفون الزبون (إجباري)" : "تلفون (اختياري)";
    }

    function saveDraft() {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        items: OlvCart.all(),
        orderType: document.getElementById("order-type").value,
        tableNumber: document.getElementById("table-number").value,
        customerPhone: document.getElementById("customer-phone").value,
        customerName: document.getElementById("customer-name").value,
        discountMode,
        discountValue,
        deliveryFee,
      }));
      const btn = document.getElementById("save-draft-btn");
      const original = btn.innerHTML;
      btn.innerHTML = olvIcon("check") + "<span>تم الحفظ</span>";
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    }

    function restoreDraftIfAny() {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (draft.items && draft.items.length) {
          OlvCart.restore(draft.items);
          if (draft.orderType) document.getElementById("order-type").value = draft.orderType;
          updateOrderTypeFields();
          if (draft.tableNumber) document.getElementById("table-number").value = draft.tableNumber;
          if (draft.customerPhone) document.getElementById("customer-phone").value = draft.customerPhone;
          if (draft.customerName) document.getElementById("customer-name").value = draft.customerName;
          if (draft.deliveryFee > 0) setDeliveryFee(draft.deliveryFee);
          if (draft.discountValue > 0) {
            discountMode = draft.discountMode === "fixed" ? "fixed" : "percent";
            discountValue = Number(draft.discountValue) || 0;
            document.getElementById("discount-value-input").value = discountValue;
            document.getElementById("discount-form").hidden = false;
            document.getElementById("discount-toggle-btn").classList.add("active");
            document.querySelectorAll(".discount-mode-tab").forEach((btn) => {
              btn.classList.toggle("on", btn.dataset.discountMode === discountMode);
            });
          }
        }
      } catch (e) { /* تجاهل أي تذكرة محفوظة تالفة */ }
    }

    function clearDraft() {
      localStorage.removeItem(DRAFT_KEY);
    }

    // رقم الكمية فوق كل صنف بالشبكة (مجموع كل أسطره بالتذكرة). اللي زاد
    // من آخر مرة بياخد "نطّة" صغيرة تأكيدًا إنو الضغطة وصلت
    var lastQty = new Map(); // var مش let: renderGrid ممكن تنادي قبل هالسطر
    function syncCardQty(animate = true) {
      const qty = new Map();
      OlvCart.all().forEach((it) => qty.set(it.productId, (qty.get(it.productId) || 0) + it.qty));
      document.querySelectorAll("#products-grid .card[data-id]").forEach((card) => {
        const q = card.querySelector(".q");
        if (!q) return;
        const n = qty.get(card.dataset.id) || 0;
        const before = (lastQty || new Map()).get(card.dataset.id) || 0;
        q.textContent = n || "";
        q.classList.toggle("show", n > 0);
        if (animate && n > before) {
          q.classList.remove("bump"); void q.offsetWidth; q.classList.add("bump");
        }
      });
      lastQty = qty;
    }

    // ورق زيتون ذهبي وأخضر بينزل بعد الدفع — زينة بس، ما بتمسك اللمس
    function leafBurst() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (let k = 0; k < 22; k++) {
        const l = document.createElement("i");
        l.className = "olv-leaf";
        l.style.left = (30 + Math.random() * 40) + "vw";
        l.style.top = "30vh";
        l.style.background = k % 3 ? "var(--olive)" : "var(--gold)";
        l.style.setProperty("--dx", (Math.random() * 40 - 20) + "vw");
        l.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
        l.style.animationDelay = (Math.random() * 0.2) + "s";
        document.body.appendChild(l);
        setTimeout(() => l.remove(), 1700);
      }
    }

    // «مسح الكل»: ضغطة أولى بتطلب تأكيد (3 ثواني)، والثانية بتشطب كل الأصناف
    let clearTimer = null;
    function resetClearBtn() {
      clearTimeout(clearTimer);
      const b = document.getElementById("cart-clear-btn");
      b.classList.remove("confirm");
      b.textContent = "مسح الكل";
    }
    function onClearBtn(e) {
      e.stopPropagation();
      const b = document.getElementById("cart-clear-btn");
      if (!b.classList.contains("confirm")) {
        b.classList.add("confirm");
        b.textContent = "تأكيد المسح؟";
        clearTimer = setTimeout(resetClearBtn, 3000);
        return;
      }
      resetClearBtn();
      OlvCart.clear();
      renderCart();
    }

    let lastCartLen = 0;
    function renderCart() {
      const cart = OlvCart.all();
      syncCardQty();
      const list = document.getElementById("cart-list");
      const checkoutBtn = document.getElementById("checkout-btn");
      const saveDraftBtn = document.getElementById("save-draft-btn");
      const itemCount = cart.reduce((s, item) => s + item.qty, 0);
      document.getElementById("ticket-badge").textContent = itemCount;
      document.getElementById("psb-item-count").textContent = cart.length;
      const clearBtn = document.getElementById("cart-clear-btn");
      clearBtn.hidden = !cart.length;
      if (!cart.length) resetClearBtn();
      document.getElementById("psb-qty-count").textContent = itemCount;
      if (!cart.length) {
        lastCartLen = 0;
        list.innerHTML = `<div class="cart-empty"><span class="ce-icon">${olvIcon("receipt")}</span><b>التذكرة فاضية</b><span>اضغط على أي صنف لتضيفه هون</span></div>`;
        checkoutBtn.disabled = true;
        saveDraftBtn.disabled = true;
      } else {
        // الأسطر الجديدة بس بتعمل حركة الدخول (مش كل التذكرة مع كل ضغطة +)
        const prevLen = lastCartLen;
        lastCartLen = cart.length;
        list.innerHTML = cart.map((item, idx) => `
          <div class="cart-item${idx >= prevLen ? " is-new" : ""}">
            <div class="cart-item-top">
              <div class="cart-item-info" data-edit="${idx}">
                <div class="name">${olvEsc(item.name)}</div>
                ${item.addons.length ? `<div class="meta">+ ${item.addons.map((a) => olvEsc(a.name)).join("، ")}</div>` : ""}
                ${item.note ? `<div class="meta">${olvIcon("note")} ${olvEsc(item.note)}</div>` : ""}
              </div>
              ${sizeKinds(item).length || iceOk(item) ? `
              <div class="cart-item-opts">
                ${sizeKinds(item).map((k) => `<button type="button" class="opt-chip${sizeKindOf(item) === k ? " on" : ""}" data-size="${idx}:${sizeKindOf(item) === k ? "" : k}" aria-pressed="${sizeKindOf(item) === k}">${k === "medium" ? "وسط" : "كبير"}</button>`).join("")}
                ${iceOk(item) ? `<button type="button" class="opt-chip${hasIce(item) ? " on" : ""}" data-ice="${idx}:${hasIce(item) ? 0 : 1}" aria-pressed="${hasIce(item)}">ثلج</button>` : ""}
              </div>` : ""}
              <div class="cart-item-price">${olvFormatMoney(OlvCart.lineTotal(item))}</div>
            </div>
            <div class="qty-stepper">
              <button type="button" data-dec="${idx}" ${item.qty <= 1 ? `class="is-remove" data-sound="remove" aria-label="حذف الصنف"` : `aria-label="نقّص واحد"`}>${item.qty <= 1 ? olvIcon("trash") : "−"}</button>
              <span class="qty-value">${item.qty}</span>
              <button type="button" data-inc="${idx}" aria-label="زيد واحد">+</button>
            </div>
            ${mealOk(item) ? `
            <div class="seg meal-seg" role="group" aria-label="نوع الطلب: ساندويش أو وجبة">
              ${[["", "ساندويش"], ["meal", "وجبة"], ["double", "وجبة دبل"]].map(([k, l]) => `<button type="button" class="${mealKindOf(item) === k ? "on" : ""}" data-meal="${idx}:${k}">${l}</button>`).join("")}
              ${mealKindOf(item) ? `<button type="button" class="meal-edit" data-meal-edit="${idx}" aria-label="تعديل سعر الوجبة" style="flex:none; width:48px;">✎</button>` : ""}
            </div>` : ""}
          </div>
        `).join("");
        list.querySelectorAll("[data-edit]").forEach((el) => {
          el.addEventListener("click", () => openItemSheet(Number(el.dataset.edit)));
        });
        list.querySelectorAll("[data-inc]").forEach((btn) => {
          btn.addEventListener("click", () => {
            OlvCart.incrementQtyAt(Number(btn.dataset.inc), 1);
            renderCart();
          });
        });
        list.querySelectorAll("[data-size]").forEach((btn) => {
          btn.addEventListener("click", () => { const [i, k] = btn.dataset.size.split(":"); setSizeKind(Number(i), k); });
        });
        list.querySelectorAll("[data-ice]").forEach((btn) => {
          btn.addEventListener("click", () => { const [i, k] = btn.dataset.ice.split(":"); setIce(Number(i), k === "1"); });
        });
        list.querySelectorAll("[data-meal]").forEach((btn) => {
          btn.addEventListener("click", () => { const [i, k] = btn.dataset.meal.split(":"); setMealKind(Number(i), k); });
        });
        list.querySelectorAll("[data-meal-edit]").forEach((btn) => {
          btn.addEventListener("click", () => { const i = Number(btn.dataset.mealEdit); askMealPrice(i, mealKindOf(OlvCart.all()[i])); });
        });
        list.querySelectorAll("[data-dec]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.dec);
            const target = OlvCart.all()[idx];
            if (target && target.qty <= 1) OlvCart.removeAt(idx);
            else OlvCart.incrementQtyAt(idx, -1);
            renderCart();
          });
        });
        checkoutBtn.disabled = false;
        saveDraftBtn.disabled = false;
      }
      updateTabBtn();
      const subtotal = OlvCart.total();
      const discountAmount = computeDiscountAmount(subtotal);
      const discountRow = document.getElementById("cart-discount-row");
      document.getElementById("cart-subtotal").textContent = olvFormatMoney(subtotal);
      // بدون خصم المجموع الفرعي = الإجمالي، فبنخبّيه ونوفّر سطر
      document.getElementById("cart-subtotal").parentElement.hidden = !(discountAmount > 0);
      if (discountAmount > 0) {
        discountRow.style.display = "";
        document.getElementById("cart-discount").textContent = "- " + olvFormatMoney(discountAmount);
      } else {
        discountRow.style.display = "none";
      }
      const fee = currentFee();
      const feeRow = document.getElementById("cart-fee-row");
      feeRow.style.display = fee > 0 ? "" : "none";
      if (fee > 0) document.getElementById("cart-fee").textContent = "+ " + olvFormatMoney(fee);
      document.getElementById("cart-total").textContent = olvFormatMoney(subtotal - discountAmount + fee);
    }

    // «أرسل للطاولة»: صالة + رقم طاولة = الطلب بينضاف على حساب الطاولة المفتوح وبينطبع للأقسام بدون دفع،
    // والكاشير بيحاسب مرة وحدة من صفحة الطاولات. «الدفع» بيضل للدفع الفوري
    function updateTabBtn() {
      const btn = document.getElementById("send-tab-btn");
      if (!btn) return;
      const table = olvNormTable(document.getElementById("table-number").value);
      const show = document.getElementById("order-type").value === "صالة" && !!table;
      btn.hidden = !show;
      document.getElementById("checkout-btn").classList.toggle("pay", !show);
      if (!show) return;
      btn.innerHTML = `${olvIcon("dineIn")}<span>أرسل لطاولة ${olvEsc(table)}</span>`;
      btn.disabled = !OlvCart.all().length;
    }

    async function sendToTable() {
      const errBox = document.getElementById("err");
      const btn = document.getElementById("send-tab-btn");
      const tableNumber = olvNormTable(document.getElementById("table-number").value);
      const customerPhone = document.getElementById("customer-phone").value.trim();
      const customerName = document.getElementById("customer-name").value.trim();
      errBox.style.display = "none";
      btn.disabled = true;
      try {
        await OlvCart.sendToTab({ tableNumber, entryDate: olvToday(), customerPhone, customerName });
        clearDraft();
        resetDiscount();
        ["table-number", "customer-name", "customer-phone"].forEach((id) => { document.getElementById(id).value = ""; });
        renderCart();
        refreshPopularityAndGrid();
        const off = OlvCart.lastOffline();
        if (off && off.queued && off.sentToKitchen) {
          olvToast(`بدون نت: وصل لشاشات المطبخ والبار وبينطبع، وبينضاف لحساب طاولة ${tableNumber} لما يرجع النت`, { type: "ok", icon: "check", ms: 6000 });
        } else if (off && off.queued) {
          olvToast("الطلب محفوظ محليًا ولم يُرسل للمطبخ/البار بعد. بلّغهم شفهيًا، وبينضاف للحساب لما يرجع النت", { type: "danger", icon: "warning", ms: 9000 });
        } else {
          olvToast(`انرسل لطاولة ${tableNumber} وانطبع للأقسام. الحساب مفتوح`, { type: "ok", icon: "check", ms: 3500 });
        }
      } catch (err) {
        const msg = String((err && err.message) || "");
        olvShowError(errBox, /place_table_order/.test(msg) && /function|schema cache/i.test(msg)
          ? new Error("ميزة حساب الطاولة لسا ما تفعّلت بقاعدة البيانات") : err);
        btn.disabled = !OlvCart.all().length;
      }
    }

    function openCheckoutSheet() {
      const errBox = document.getElementById("err");
      const orderType = document.getElementById("order-type").value;
      const tableNumber = olvNormTable(document.getElementById("table-number").value);
      const customerPhone = document.getElementById("customer-phone").value.trim();
      const customerName = document.getElementById("customer-name").value.trim();
      if (orderType === "توصيل" && !customerPhone) {
        olvShowError(errBox, new Error("لازم تدخل رقم تلفون الزبون قبل إتمام طلب التوصيل"));
        document.getElementById("customer-phone").focus();
        return;
      }
      errBox.style.display = "none";

      const subtotal = OlvCart.total();
      const discountAmount = computeDiscountAmount(subtotal);
      const deliveryFeeNow = currentFee();
      const total = subtotal - discountAmount + deliveryFeeNow;
      const cartSnapshot = OlvCart.all().slice();
      const exact = Math.round(total * 100) / 100;
      let method = "cash";
      let receivedCents = 0;
      let isSubmitting = false;
      // «على حساب موظف»: الموظف + المبلغ المحمّل عليه = سعر المنيو ناقص 15% (قرار المالك 2026-11-13).
      // قبل كان بسعر التكلفة، بس تكلفة أصناف كتير مش مسجّلة فكانت تنحسب قروش. المبلغ ثابت وما بيتعدّل بالإيد
      const STAFF_DISCOUNT = 0.15;
      let staffList = null, staffId = "", staffErr = "";
      const staffAmount = (Math.round(exact * (1 - STAFF_DISCOUNT) * 100) / 100).toFixed(2);
      async function loadStaffInfo() {
        if (staffList) return;
        try {
          const { data, error } = await window.supabaseClient.rpc("staff_names");
          if (error) throw error;
          staffList = data || [];
        } catch (e) {
          staffList = [];
          staffErr = /staff_names/.test(String(e && e.message)) ? "ميزة الحساب على الموظف لسا ما تفعّلت بقاعدة البيانات" : ((e && e.message) || "تعذّر تحميل الموظفين");
        }
      }

      const backdrop = document.createElement("div");
      backdrop.className = "checkout-backdrop";
      const modal = document.createElement("div");
      modal.className = "checkout-modal";
      backdrop.appendChild(modal);

      function quickAmounts() {
        const amounts = new Set([exact]);
        [5, 10, 20, 50].forEach((denom) => {
          const rounded = Math.ceil(exact / denom) * denom;
          if (rounded > exact) amounts.add(rounded);
        });
        return Array.from(amounts).sort((a, b) => a - b).slice(0, 4);
      }

      function render() {
        const receivedAmount = receivedCents / 100;
        const change = receivedAmount - exact;
        const canConfirm = method === "staff" ? !!staffId && Number(staffAmount) > 0 : (method !== "cash" || receivedAmount >= exact);

        modal.innerHTML = `
          <div class="checkout-head">
            <h2>إتمام الدفع</h2>
            <button type="button" class="checkout-close" id="checkout-close">${olvIcon("x")}</button>
          </div>
          <div class="checkout-body${method === "cash" || method === "staff" ? " has-cash" : ""}">
          <div class="checkout-info">
          <div class="checkout-total">
            <div class="label">الإجمالي المطلوب</div>
            <div class="amount" dir="ltr">${olvFormatMoney(exact)}</div>
          </div>
          <div class="checkout-summary">
            ${cartSnapshot.map((item) => `
              <div class="row"><span>${item.qty}× ${olvEsc(item.name)}</span><span>${olvFormatMoney(OlvCart.lineTotal(item))}</span></div>
            `).join("")}
            ${discountAmount > 0 ? `
              <div class="row"><span>المجموع الفرعي</span><span>${olvFormatMoney(subtotal)}</span></div>
              <div class="row"><span>الخصم${discountMode === "percent" ? ` (${discountValue}%)` : ""}</span><span>- ${olvFormatMoney(discountAmount)}</span></div>
            ` : ""}
          </div>
          <div class="pm-tiles">
            <button type="button" class="pm-tile${method === "cash" ? " on" : ""}" data-method="cash">${olvIcon("banknote")}كاش</button>
            <button type="button" class="pm-tile${method === "card" ? " on" : ""}" data-method="card">${olvIcon("creditCard")}شبكة</button>
            <button type="button" class="pm-tile${method === "cliq" ? " on" : ""}" data-method="cliq">${olvIcon("creditCard")}كليك</button>
            <button type="button" class="pm-tile${method === "delivery" ? " on" : ""}" data-method="delivery">${olvIcon("mapPin")}توصيل</button>
            <button type="button" class="pm-tile${method === "staff" ? " on" : ""}" data-method="staff">${olvIcon("person")}حساب موظف</button>
          </div>
          </div>
          ${method === "staff" ? `
            <div class="staff-panel">
              <div>
                <label for="staff-sel">الموظف</label>
                <select id="staff-sel"><option value="">${staffList ? "اختار الموظف…" : "بنحمّل…"}</option>${(staffList || []).map((u) => `<option value="${olvEsc(u.id)}"${u.id === staffId ? " selected" : ""}>${olvEsc(u.full_name)}</option>`).join("")}</select>
              </div>
              <div>
                <label for="staff-amt">المبلغ عليه (سعر المنيو ناقص ${Math.round(STAFF_DISCOUNT * 100)}%)</label>
                <input id="staff-amt" type="number" dir="ltr" value="${olvEsc(staffAmount)}" readonly aria-readonly="true">
              </div>
              ${staffErr ? `<div class="staff-hint warn">${olvEsc(staffErr)}</div>` : `<div class="staff-hint">سعر المنيو ${olvFormatMoney(exact)} ناقص ${Math.round(STAFF_DISCOUNT * 100)}% خصم موظفين. بينسجّل ذمة على الموظف وبينخصم من راتبه، أو بيسدّد قبلها. ما بينزل بالدرج. بالصالة قد يحتاج رمز المدير.</div>`}
            </div>
          ` : ""}
          ${method === "cash" ? `
            <div class="cash-panel">
              <div class="received-row">
                <span class="label">المبلغ المستلم</span>
                <span class="value" dir="ltr">${olvFormatMoney(receivedAmount)}</span>
              </div>
              <div class="quick-amounts">
                ${quickAmounts().map((amt) => `<button type="button" data-amt="${amt}">${amt === exact ? "بالضبط" : olvFormatMoney(amt)}</button>`).join("")}
              </div>
              <div class="keypad">
                ${["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => `<button type="button" data-key="${k}">${k}</button>`).join("")}
              </div>
              <div class="change-row${change < 0 ? " insufficient" : ""}">
                <span class="label">${change < 0 ? "المتبقي على الزبون" : "الباقي للزبون"}</span>
                <span class="value" dir="ltr">${olvFormatMoney(Math.abs(change))}</span>
              </div>
            </div>
          ` : ""}
          </div>
          <button type="button" class="btn gold checkout-confirm" id="checkout-confirm"${canConfirm ? "" : " disabled"}>تأكيد الدفع</button>
          <div class="checkout-success" id="checkout-success">
            <div class="check">${olvIcon("check")}</div>
            <div class="msg">تم تسجيل البيع بنجاح</div>
          </div>
        `;

        modal.querySelector("#checkout-close").addEventListener("click", close);
        modal.querySelectorAll(".pm-tile").forEach((btn) => {
          btn.addEventListener("click", () => {
            method = btn.dataset.method; render();
            if (method === "staff" && !staffList) loadStaffInfo().then(() => { if (method === "staff") render(); });
          });
        });
        if (method === "staff") {
          modal.querySelector("#staff-sel").addEventListener("change", (e) => { staffId = e.target.value; modal.querySelector("#checkout-confirm").disabled = !(staffId && Number(staffAmount) > 0); });
        }
        if (method === "cash") {
          modal.querySelectorAll(".quick-amounts button").forEach((btn) => {
            btn.addEventListener("click", () => { receivedCents = Math.round(Number(btn.dataset.amt) * 100); render(); });
          });
          modal.querySelectorAll(".keypad button").forEach((btn) => {
            btn.addEventListener("click", () => {
              const k = btn.dataset.key;
              if (k === "C") receivedCents = 0;
              else if (k === "⌫") receivedCents = Math.floor(receivedCents / 10);
              else receivedCents = Math.min(receivedCents * 10 + Number(k), 99999999);
              render();
            });
          });
        }
        modal.querySelector("#checkout-confirm").addEventListener("click", confirmPayment);
      }

      async function confirmPayment() {
        const confirmBtn = modal.querySelector("#checkout-confirm");
        const closeBtn = modal.querySelector("#checkout-close");
        confirmBtn.disabled = true;
        if (closeBtn) closeBtn.disabled = true;
        isSubmitting = true;
        const errBox = document.getElementById("err");
        try {
          let extraNotes = "بيع سريع";
          let cashReceived = null;
          let changeDue = null;
          if (method === "cliq") extraNotes += " — دفع كليك";
          if (method === "cash") {
            cashReceived = receivedCents / 100;
            changeDue = Math.max(cashReceived - exact, 0);
            extraNotes += ` — مستلم ${olvFormatMoney(cashReceived)}، الباقي ${olvFormatMoney(changeDue)}`;
          }
          const queuedBefore = window.olvGetOfflineQueueCount ? window.olvGetOfflineQueueCount() : 0;
          let staffSaleId = null;
          if (method === "staff") {
            if (!navigator.onLine) throw new Error("الحساب على الموظف بيحتاج اتصال بالإنترنت. اختار كاش أو حاول لما يرجع النت");
            const who = (staffList || []).find((u) => u.id === staffId);
            if (!who || !(Number(staffAmount) > 0)) throw new Error("اختار الموظف");
            extraNotes = `على حساب الموظف ${who.full_name} — ${olvFormatMoney(Number(staffAmount))}`;
          }
          // خصم فوق حد الكاشير: السيرفر بيرفض، فبنسأل عن رمز المدير وبنعيد نفس البيع (client_ref بيمنع التكرار)
          const itemsNote = cartSnapshot.map((i) => `${i.qty}× ${i.name}`).join("، ");
          if (method === "staff" && window.olvRole === "staff") {
            // الكاشير بيبيع على حساب موظف بدون رمز المدير: موافقة تلقائية لبيعة وحدة (الذمة بتنسجّل على الموظف)
            const { error: apErr } = await window.supabaseClient.rpc("staff_account_approval");
            if (apErr) {
              const m = String(apErr.message || "");
              if (/staff_account_approval/.test(m) && /function|schema cache/i.test(m)) throw new Error("البيع على حساب الموظف بدون رمز لسا ما تفعّل بقاعدة البيانات");
              throw apErr;
            }
          }
          staffSaleId = await olvWithApproval("discount", () => OlvCart.checkout({
            paymentMethod: method, entryDate: olvToday(), extraNotes, orderType, cashReceived, changeDue,
            tableNumber: tableNumber || null, customerPhone: customerPhone || null, customerName: customerName || null,
            discountAmount, deliveryFee: deliveryFeeNow,
          }));
          if (method === "staff") {
            // البيعة انحفظت؛ هلأ منسجّل الذمة على الموظف. لو فشلت لازم الكاشير يعرف حتى ما تضيع
            const { error: chErr } = await window.supabaseClient.rpc("add_staff_charge", {
              p_profile_id: staffId, p_sale_id: staffSaleId, p_amount: Number(staffAmount), p_note: "طلب على الحساب: " + itemsNote,
            });
            if (chErr) {
              clearDraft(); resetDiscount(); renderCart(); refreshPopularityAndGrid();
              isSubmitting = false; close();
              olvShowError(errBox, new Error("البيعة انحفظت بس الذمة على الموظف ما انسجلت (" + (chErr.message || "خطأ") + "). بلّغ المدير يسجّلها يدويًا من الرواتب > سلف: " + olvFormatMoney(Number(staffAmount))));
              return;
            }
          }
          clearDraft();
          resetDiscount();
          // بعد كل بيع: فضّي الاسم ورقم الصالة والتلفون حتى الطلب الجاي يبدأ فاضي
          ["table-number", "customer-name", "customer-phone"].forEach((id) => { document.getElementById(id).value = ""; });
          renderCart();
          refreshPopularityAndGrid();
          // لو النت مقطوع، الطلب انحفظ محليًا بس (offline-queue.js) وما وصل لقاعدة
          // البيانات — فما رح ينطبع للمطبخ/البار قبل رجوع النت. لازم الكاشير يعرف
          // بوضوح ويبلّغ المطبخ شفهيًا، مو يفكر إن كل شي تمام
          const queued = window.olvGetOfflineQueueCount && window.olvGetOfflineQueueCount() > queuedBefore;
          const viaLocal = queued && OlvCart.lastOffline().sentToKitchen;
          if (viaLocal) {
            // كمبيوتر المحل استلم الطلب: وصل لشاشات المطبخ والبارات، بس الطابعة بتستنى النت
            const no = OlvCart.lastOffline().orderNo;
            const msgEl = modal.querySelector("#checkout-success .msg");
            msgEl.innerHTML = `بدون نت: الطلب ${no ? `<b>${olvEsc(no)}</b> ` : ""}وصل لشاشات المطبخ والبار<br>بيرتفع للسحابة وبينطبع لما يرجع النت`;
            msgEl.style.color = "var(--gold-dp)";
            msgEl.style.textAlign = "center";
            msgEl.style.lineHeight = "1.7";
          } else if (queued) {
            const msgEl = modal.querySelector("#checkout-success .msg");
            msgEl.innerHTML = "الطلب محفوظ محليًا <b>ولم يُرسل للمطبخ/البار بعد</b><br>بلّغهم شفهيًا — بينطبع لما يرجع النت";
            msgEl.style.color = "var(--danger-hi)";
            msgEl.style.textAlign = "center";
            msgEl.style.lineHeight = "1.7";
          }
          modal.querySelector("#checkout-success").classList.add("show");
          // الكاشير ما لازم يستنى: لمسة على شاشة النجاح بتسكّرها فورًا (ومؤقت 650ms للحالة العادية)
          modal.querySelector("#checkout-success").addEventListener("click", close);
          const warn = queued && !viaLocal;
          if (typeof OlvSound !== "undefined") warn ? OlvSound.playError() : OlvSound.playSuccess();
          if (!queued) leafBurst();
          isSubmitting = false;
          setTimeout(close, warn ? 6000 : queued ? 2500 : 650);
        } catch (err) {
          olvShowError(errBox, err);
          confirmBtn.disabled = false;
          if (closeBtn) closeBtn.disabled = false;
          isSubmitting = false;
        }
      }

      // يمنع إغلاق النافذة (بالضغط بره أو زر ✕) أثناء إرسال عملية البيع
      // فعليًا، حتى ما تختفي الشاشة قبل ما يتأكد الكاشير إنها نجحت
      let closingModal = false;
      function close() {
        if (isSubmitting || closingModal) return;
        closingModal = true;
        backdrop.classList.remove("in"); // خروج: بيتلاشى 150ms بنفس مسار الدخول ثم بينشال
        setTimeout(() => backdrop.remove(), 170);
      }
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
      render();
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add("in"));
    }

    // يعيد تحميل ترتيب "الأكثر مبيعًا" من قاعدة البيانات ويعيد رسم القائمة —
    // يُستدعى عند فتح الشاشة، وأيضًا بعد كل عملية بيع (لأن الشاشة صارت
    // تبقى مفتوحة على نفسها بدل الانتقال لصفحة أخرى)
    // المنيو بينحمّل مرة وحدة لما تنفتح الشاشة، والكاشير بيضل فاتحها طول اليوم: منحدّثه كل 5 دقايق
    // ولما ترجع للشاشة، ومنصحّح أسعار السلة (والمسودة المحفوظة) لآخر سعر — السيرفر بيحسب بالسعر
    // الحالي، فأي فرق كان بيطلع «خصم» مش مقصود أو رفض «الخصم يتعدى الحد»
    function syncCartPrices() {
      const byId = new Map(products.map((p) => [p.id, p]));
      const addonById = new Map(addons.map((a) => [a.id, a]));
      let changed = 0;
      const gone = [];
      OlvCart.all().forEach((item, idx) => {
        const p = byId.get(item.productId);
        if (!p) { gone.push(item.name); return; }
        const newAddons = item.addons.map((a) => (addonById.has(a.id) ? { ...a, price: Number(addonById.get(a.id).price) } : a));
        const newHall = Number(p.hall_price) > 0 ? Number(p.hall_price) : null;
        const priceDiff = Number(p.price) !== item.unitBase || newHall !== (item.hallPrice ?? null) || newAddons.some((a, i) => a.price !== item.addons[i].price);
        if (priceDiff) { OlvCart.updateAt(idx, { unitBase: Number(p.price), hallPrice: newHall, addons: newAddons }); changed++; }
      });
      if (changed) showToast(`تحدّث سعر ${changed} صنف بالسلة حسب المنيو الحالي`, "var(--gold-dp)", "tag");
      if (gone.length) showToast(`انتبه: ${gone.join("، ")} مش موجود بالمنيو هلأ`, "var(--danger)", "warning");
      if (changed || gone.length) renderCart();
    }
    // آخر منيو انقرا من السيرفر، حتى الكاشير يقدر يبيع إذا انفتحت الصفحة والنت مقطوع
    const MENU_CACHE_KEY = "olv_pos_menu_cache_v1";
    function saveMenuCache() {
      try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({ products, addons, hookahFlavors, hookahStock, at: Date.now() })); } catch (_) { /* خزنة ممتلئة */ }
    }
    function loadMenuCache() {
      try {
        const c = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || "null");
        if (!c || !Array.isArray(c.products) || !c.products.length) return false;
        products = c.products;
        addons = c.addons || [];
        hookahFlavors = c.hookahFlavors || [];
        hookahStock = c.hookahStock || [];
        return true;
      } catch (_) { return false; }
    }
    // قسم الصنف (لشاشة المطبخ المحلية): بيستعمله sale-cart.js لأصناف مسودة محفوظة قبل ما نضيف القسم للسلة
    window.olvCategoryOf = (id) => { const p = products.find((x) => x.id === id); return p ? p.category : null; };

    async function loadMealCats() {
      try {
        const f = await window.supabaseClient.from("app_settings").select("value").eq("key", "hookah_flavors").maybeSingle();
        hookahFlavors = ((f.data && f.data.value) || "").split("|").map((x) => x.trim()).filter(Boolean);
        const ing = await window.supabaseClient.from("ingredients").select("name").like("name", "معسل%").order("name");
        if (!ing.error) hookahStock = (ing.data || []).map((r) => r.name).filter((n) => !/كيلو/.test(n));
      } catch (_) { /* نبقى على آخر قيمة محفوظة */ }
    }

    async function refreshMenu() {
      const [{ data: prodData, error: e1 }, { data: addonData, error: e2 }] = await Promise.all([
        window.supabaseClient.from("products").select("*").eq("is_active", true).order("category").order("sort_order"),
        window.supabaseClient.from("addons").select("*").eq("is_active", true).order("name"),
      ]);
      if (e1 || e2 || !prodData) return;
      products = prodData;
      addons = addonData || [];
      await loadMealCats();
      saveMenuCache();
      renderCategoryTabs();
      renderGrid();
      syncCartPrices();
    }

    async function refreshPopularityAndGrid() {
      const { data: salesData, error } = await window.supabaseClient.from("product_sales_totals").select("*");
      if (error) return;
      popularity = {};
      (salesData || []).forEach((r) => { popularity[r.product_id] = Number(r.total_qty); });
      renderCategoryTabs();
      renderGrid();
    }

    (async () => {
      session = await olvRequireAuth();
      if (!session) return;
      const errBox = document.getElementById("err");
      if (window.olvRole === "staff") {
        try {
          const { data: lim } = await window.supabaseClient
            .from("app_settings").select("value").eq("key", "staff_max_discount_percent").maybeSingle();
          const n = lim ? Number(lim.value) : 10;
          staffMaxDiscountPct = Number.isFinite(n) ? n : 10;
          const hint = document.createElement("div");
          hint.className = "hint";
          hint.style.cssText = "font-size:12px; margin-top:6px;";
          hint.textContent = staffMaxDiscountPct > 0
            ? `أقصى خصم مسموح للكاشير: ${staffMaxDiscountPct}% — أكثر من هيك بيحتاج مدير`
            : "الخصم غير مسموح للكاشير — بيحتاج مدير";
          document.getElementById("discount-form").appendChild(hint);
        } catch (e) { /* السيرفر بيفرض الحد بأي حال */ }
      }
      try {
        const [{ data: prodData, error: e1 }, { data: addonData, error: e2 }, { data: salesData, error: e3 }] = await Promise.all([
          window.supabaseClient.from("products").select("*").eq("is_active", true).order("category").order("sort_order"),
          window.supabaseClient.from("addons").select("*").eq("is_active", true).order("name"),
          // الأكثر مبيعًا مجرد ترتيب: ما لازم نوقف فتح الكاشير عليه، بنحمّله بالخلفية
          Promise.resolve({ data: null }),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        products = prodData || [];
        addons = addonData || [];
        await loadMealCats();
        saveMenuCache();
        popularity = {};
        (salesData || []).forEach((r) => { popularity[r.product_id] = Number(r.total_qty); });
        renderCategoryTabs();
        renderGrid();
        refreshPopularityAndGrid();
      } catch (err) {
        // النت مقطوع والصفحة انفتحت من جديد: منبيع من آخر منيو محفوظ على هالجهاز
        if (olvIsNetworkError(err) && loadMenuCache()) {
          renderCategoryTabs();
          renderGrid();
          showToast("بدون نت: المنيو من آخر نسخة محفوظة على هالجهاز", "var(--gold-dp)", "warning");
        } else {
          olvShowError(errBox, err);
        }
      }
      // سحب الأصناف والصور من منيو الموقع (بالخلفية وبدون ما يوقف الشاشة، من أي حساب)
      OlvMenuProducts.autoSync().then((done) => { if (done) refreshMenu(); });
      // وتتكرر كل دقيقة والشاشة مفتوحة، حتى يوصل أي تعديل سعر بالمنيو بدون ما يحتاج إعادة فتح
      setInterval(() => {
        if (document.hidden) return;
        OlvMenuProducts.autoSync().then((done) => { if (done) refreshMenu(); });
      }, 60 * 1000);
      updateOrderTypeFields();
      restoreDraftIfAny();
      applyTableFromLink();
      loadTableOptions();
      renderCart();
      document.getElementById("order-type").addEventListener("change", updateOrderTypeFields);
      document.getElementById("order-type-seg").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-type]");
        if (!b) return;
        const sel = document.getElementById("order-type");
        sel.value = b.dataset.type;
        sel.dispatchEvent(new Event("change"));
      });
      document.getElementById("fee-chips").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-fee]");
        if (b) setDeliveryFee(b.dataset.fee);
      });
      document.getElementById("fee-input").addEventListener("input", (e) => {
        deliveryFee = Math.round(Math.min(Math.max(Number(e.target.value) || 0, 0), 50) * 100) / 100;
        document.querySelectorAll("#fee-chips button").forEach((b) => b.classList.remove("on"));
        renderCart();
      });
      document.getElementById("checkout-btn").addEventListener("click", openCheckoutSheet);
      document.getElementById("send-tab-btn").addEventListener("click", sendToTable);
      document.getElementById("table-number").addEventListener("input", updateTabBtn);
      // رجوع من صفحة ثانية (الطاولات مثلاً): المتصفح بيرجّع الشاشة بحقولها القديمة؛ لو التذكرة فاضية منفضّي الطاولة والاسم
      window.addEventListener("pageshow", (e) => {
        if (!e.persisted || OlvCart.all().length) return;
        ["table-number", "customer-name", "customer-phone"].forEach((id) => { document.getElementById(id).value = ""; });
        updateTabBtn();
      });
      // فحص سريع (مو إجباري) لما الكاشير يخلص كتابة رقم هاتف — لو الرقم
      // لزبون متكرر موجود أصلًا ببرنامج الولاء، بيطلعله تنبيه ترحيبي
      document.getElementById("customer-phone").addEventListener("blur", async (e) => {
        const phone = e.target.value.trim();
        if (!phone) return;
        // نفس توحيد صيغة الرقم يلي بالقاعدة (07xxxxxxxx) حتى +962 و00962 يلاقوا الزبون
        let norm = phone.replace(/\D/g, "");
        if (norm.startsWith("00962")) norm = "0" + norm.slice(5);
        else if (norm.startsWith("962") && norm.length === 12) norm = "0" + norm.slice(3);
        else if (norm.length === 9 && norm.startsWith("7")) norm = "0" + norm;
        const { data } = await window.supabaseClient
          .from("customers").select("name, visit_count, points_balance").eq("phone", norm || phone).maybeSingle();
        if (data) {
          showToast(`عميل متكرر: ${data.name || phone} — زيارة رقم ${data.visit_count + 1}، ${data.points_balance} نقطة`, "var(--gold-dp)", "star");
        }
      });
      document.getElementById("save-draft-btn").addEventListener("click", saveDraft);
      const clearBtnEl = document.getElementById("cart-clear-btn");
      clearBtnEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      clearBtnEl.addEventListener("click", onClearBtn);
      document.getElementById("discount-toggle-btn").addEventListener("click", () => {
        const form = document.getElementById("discount-form");
        form.hidden = !form.hidden;
        if (!form.hidden) document.getElementById("discount-value-input").focus();
      });
      document.querySelectorAll(".discount-mode-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          discountMode = btn.dataset.discountMode;
          document.querySelectorAll(".discount-mode-tab").forEach((b) => b.classList.toggle("on", b === btn));
          renderCart();
        });
      });
      document.getElementById("discount-value-input").addEventListener("input", (e) => {
        discountValue = Math.max(0, Number(e.target.value) || 0);
        // الكاشير: نرجّع القيمة المكتوبة للسقف المسموح فعلًا (بدل ما تبين 50% والمحسوب أقل)
        if (staffMaxDiscountPct !== null && discountValue > 0) {
          const cap = discountMode === "percent"
            ? staffMaxDiscountPct
            : Math.floor(OlvCart.total() * staffMaxDiscountPct) / 100;
          if (discountValue > cap) {
            discountValue = cap;
            e.target.value = cap;
            showToast(`أقصى خصم للكاشير ${staffMaxDiscountPct}% — أكثر من هيك بيحتاج مدير`, "var(--danger)", "warning");
          }
        }
        document.getElementById("discount-toggle-btn").classList.toggle("active", discountValue > 0);
        renderCart();
      });
      document.getElementById("discount-remove-btn").addEventListener("click", resetDiscount);
      document.getElementById("product-search").addEventListener("input", (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        currentPage = 1;
        renderGrid();
      });
      // اختصارات الكاشير بالكيبورد. ما بتشتغل وفي نافذة مفتوحة (دفع، تعديل صنف، إعادة طباعة)،
      // ولا وانت عم تكتب بخانة ثانية غير البحث
      const searchEl = document.getElementById("product-search");
      searchEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const first = document.querySelector("#products-grid .card[data-id]");
          if (!first || !searchTerm) return;
          quickAddToCart(first.dataset.id);
          searchEl.select(); // الصنف الجاي بيتكتب فوق القديم مباشرة
        } else if (e.key === "Escape" && searchEl.value) {
          e.preventDefault();
          searchEl.value = ""; searchTerm = ""; currentPage = 1; renderGrid();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || e.altKey) return;
        if (document.querySelector(".sheet-backdrop, .checkout-backdrop, .olv-modal-backdrop")) return;
        const t = e.target;
        const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (e.key === "F2" || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
          const pay = document.getElementById("checkout-btn");
          if (pay && !pay.disabled) { e.preventDefault(); pay.click(); }
          return;
        }
        if (typing || e.ctrlKey || e.metaKey) return;
        if (e.code === "Slash" || e.key === "/") {
          e.preventDefault(); searchEl.focus(); searchEl.select();
        } else if (e.key === "+" || e.key === "-" || e.code === "NumpadAdd" || e.code === "NumpadSubtract") {
          const cart = OlvCart.all();
          if (!cart.length) return;
          e.preventDefault();
          const last = cart.length - 1;
          const down = e.key === "-" || e.code === "NumpadSubtract";
          if (down && cart[last].qty <= 1) return; // الحذف بيضل من التذكرة نفسها، مش من الكيبورد
          OlvCart.incrementQtyAt(last, down ? -1 : 1);
          if (!down) olvHaptic();
          renderCart();
        }
      });
      document.getElementById("page-prev").addEventListener("click", () => { currentPage--; renderGrid(); });
      document.getElementById("page-next").addEventListener("click", () => { currentPage++; renderGrid(); });
      let resizeTimer = null;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { placeCategories(); updateNavHeight(); updateStatusBarHeight(); updatePosHeight(); renderGrid(); }, 200);
      });

      syncCartPrices(); // مسودة محفوظة من قبل ممكن تكون بأسعار قديمة
      setInterval(refreshMenu, 5 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshMenu(); });

      await checkForReadyOrders();
      setInterval(checkForReadyOrders, 15000);
    })();
    });
