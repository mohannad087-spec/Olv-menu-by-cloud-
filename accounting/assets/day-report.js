// تقرير آخر اليوم كصورة جاهزة للواتساب. مشترك بين الرئيسية وتقفيل الخزينة:
//   olvOpenDayReport(dateStr)  ← بيجيب أرقام اليوم (مبيعات، مصروفات، طرق الدفع،
//                                 الأكثر مبيعًا، وتقفيل الخزينة لو موجود)، بيرسمها
//                                 على صورة PNG، وبيفتح نافذة فيها معاينة وأزرار
//                                 «شارك» (واتساب وغيره) و«تنزيل» و«نسخ كنص»
// الصورة دايمًا بألوان الفاتح (كريمي + ذهبي + زيتوني) مهما كان وضع التطبيق،
// عشان تطلع نفس الشي عند كل اللي بيستلموها
(function () {
  const W = 1080, P = 72;
  const C = {
    bg: "#f7f1e6", card: "#fffdf8", line: "#e6dac3", text: "#2f2416", muted: "#7c6a50",
    gold: "#b08a3e", goldDp: "#6b4c14", goldHi: "#e6c983", olive: "#56692e", red: "#a3321f",
    dark: "#17120d", darkText: "#d9cdb6", brown: "#8a6a26",
  };
  const F = (w, s) => `${w} ${s}px Tajawal, system-ui, sans-serif`;
  const money = (n) => olvFormatMoney(n);
  const whole = (n) => Number(n).toLocaleString("en", { maximumFractionDigits: 2 });

  function injectStyles() {
    if (document.getElementById("olv-dr-style")) return;
    const st = document.createElement("style");
    st.id = "olv-dr-style";
    st.textContent = `
      .olv-dr-backdrop{position:fixed; inset:0; background:rgba(8,7,4,.6); backdrop-filter:blur(6px); z-index:200;
        display:flex; align-items:center; justify-content:center; padding:16px;}
      .olv-dr-modal{width:100%; max-width:440px; max-height:92vh; display:flex; flex-direction:column; gap:12px;
        background:var(--ink-2); border:1px solid var(--hair); border-radius:20px; padding:18px;
        box-shadow:0 24px 60px rgba(0,0,0,.5); color:var(--paper); font-family:'Tajawal',sans-serif;}
      .olv-dr-modal h2{font-size:18px; margin:0;}
      .olv-dr-sub{color:var(--muted); font-size:13px; line-height:1.6;}
      .olv-dr-prev{flex:1; min-height:0; overflow-y:auto; border-radius:14px; border:1px solid var(--hair-soft); background:var(--ink-3);}
      .olv-dr-prev img{display:block; width:100%; height:auto;}
      .olv-dr-wait{padding:60px 16px; text-align:center; color:var(--muted);}
      .olv-dr-actions{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
      .olv-dr-actions .btn{min-height:46px; justify-content:center;}
      .olv-dr-actions .main{grid-column:1 / -1;}
      .olv-dr-err{color:var(--danger-hi); font-size:13px;}
    `;
    document.head.appendChild(st);
  }

  // ---------- البيانات ----------
  async function loadDay(date) {
    const db = window.supabaseClient;
    const [salesR, expR, closeR] = await Promise.allSettled([
      db.from("sales_entries")
        .select("id, cash_amount, card_amount, delivery_amount, created_at, sale_items(product_name, qty, unit_price, status)")
        .eq("entry_date", date).eq("status", "completed").limit(3000),
      db.from("expenses").select("amount").eq("expense_date", date),
      db.from("cash_closings").select("expected_closing, actual_closing, difference, created_at")
        .eq("closing_date", date).order("created_at", { ascending: false }).limit(1),
    ]);
    const ok = (r) => (r.status === "fulfilled" && !r.value.error ? r.value.data || [] : null);
    const sales = ok(salesR);
    if (!sales) throw (salesR.value && salesR.value.error) || salesR.reason || new Error("تعذّر جلب المبيعات");
    const exp = ok(expR);
    const close = ok(closeR);

    const d = { date, cash: 0, card: 0, delivery: 0, count: sales.length, first: null, last: null, items: [] };
    const by = new Map();
    sales.forEach((s) => {
      d.cash += Number(s.cash_amount) || 0;
      d.card += Number(s.card_amount) || 0;
      d.delivery += Number(s.delivery_amount) || 0;
      const t = new Date(s.created_at);
      if (!d.first || t < d.first) d.first = t;
      if (!d.last || t > d.last) d.last = t;
      (s.sale_items || []).filter((x) => x.status !== "voided").forEach((x) => {
        const o = by.get(x.product_name) || { q: 0, m: 0 };
        o.q += Number(x.qty) || 0; o.m += (Number(x.qty) || 0) * (Number(x.unit_price) || 0);
        by.set(x.product_name, o);
      });
    });
    d.total = d.cash + d.card + d.delivery;
    d.items = [...by].map(([name, o]) => ({ name, ...o })).sort((a, b) => b.m - a.m).slice(0, 5);
    d.expenses = exp ? exp.reduce((s, r) => s + (Number(r.amount) || 0), 0) : null; // null = ما في صلاحية تشوفها
    d.closing = close && close[0] ? close[0] : null;
    return d;
  }

  // ---------- الرسم ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, font, color, align) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || "right"; ctx.fillText(s, x, y);
  }
  // بيقص النص من آخره لو أطول من العرض، وبيحط «…»
  function fit(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t + "…";
  }
  function loadImg(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }

  async function draw(d) {
    try { await Promise.all([document.fonts.load(F(800, 40)), document.fonts.load(F(500, 30)), document.fonts.load(F(700, 30))]); } catch (_) {}
    const logo = await loadImg("assets/brand/olv-mark.png");
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = 2600;
    const ctx = cv.getContext("2d");
    ctx.direction = "rtl";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, cv.height);
    const R = W - P, inner = W - P * 2;

    // الرأس الغامق مع الشعار
    ctx.fillStyle = C.dark; ctx.fillRect(0, 0, W, 280);
    ctx.fillStyle = C.gold; ctx.fillRect(0, 276, W, 4);
    if (logo) {
      const h = 120, w = logo.width * (h / logo.height);
      ctx.drawImage(logo, P, 80, Math.min(w, 300), h);
    }
    const dt = new Date(d.date + "T12:00:00");
    const isToday = d.date === olvToday();
    text(ctx, isToday ? "تقرير اليوم" : "تقرير يوم", R, 140, F(800, 64), C.goldHi);
    text(ctx, dt.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", year: "numeric", numberingSystem: "latn" }), R, 200, F(500, 34), C.darkText);

    let y = 380;
    // المبيعات: الرقم الأكبر
    text(ctx, "المبيعات", R, y, F(700, 34), C.muted);
    y += 120;
    text(ctx, money(d.total), R, y, F(800, 124), C.goldDp);
    y += 60;
    if (d.first) {
      const hm = (t) => t.toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit", numberingSystem: "latn" });
      text(ctx, `من ${hm(d.first)} لـ ${hm(d.last)}`, R, y, F(500, 30), C.muted);
    }
    y += 50;

    // ثلاث بلاطات: مصروفات، صافي، فواتير
    const gap = 24, tw = (inner - gap * 2) / 3, th = 190;
    const tiles = [
      { l: "المصروفات", v: d.expenses == null ? "—" : money(d.expenses), c: C.text },
      d.expenses == null
        ? { l: "متوسط الفاتورة", v: d.count ? money(d.total / d.count) : "—", c: C.text }
        : { l: "الصافي", v: money(d.total - d.expenses), c: d.total - d.expenses < 0 ? C.red : C.olive },
      { l: "الفواتير", v: whole(d.count), c: C.text, s: d.count && d.expenses != null ? "متوسط " + money(d.total / d.count) : "" },
    ];
    tiles.forEach((t, i) => {
      const x = R - tw - i * (tw + gap);
      rr(ctx, x, y, tw, th, 28); ctx.fillStyle = C.card; ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, t.l, x + tw - 28, y + 58, F(700, 28), C.muted);
      ctx.font = F(800, 52);
      let size = 52;
      while (size > 30 && ctx.measureText(t.v).width > tw - 56) { size -= 2; ctx.font = F(800, size); }
      text(ctx, t.v, x + tw - 28, y + 130, F(800, size), t.c);
      if (t.s) { ctx.font = F(500, 24); text(ctx, fit(ctx, t.s, tw - 56), x + tw - 28, y + 168, F(500, 24), C.muted); }
    });
    y += th + 70;

    // طرق الدفع: شريط مقسوم + شرح
    if (d.total > 0) {
      text(ctx, "طرق الدفع", R, y, F(700, 34), C.text);
      y += 34;
      const parts = [
        { l: "كاش", v: d.cash, c: C.gold },
        { l: "شبكة", v: d.card, c: C.olive },
        { l: "توصيل", v: d.delivery, c: C.brown },
      ].filter((p) => p.v > 0);
      ctx.save(); rr(ctx, P, y, inner, 40, 20); ctx.clip();
      let xr = R;
      parts.forEach((p) => { const w = inner * (p.v / d.total); ctx.fillStyle = p.c; ctx.fillRect(xr - w, y, w + 1, 40); xr -= w; });
      ctx.restore();
      y += 92;
      let lx = R;
      parts.forEach((p) => {
        const label = `${p.l} ${money(p.v)} · ${Math.round(p.v / d.total * 100)}%`;
        ctx.font = F(500, 28);
        const w = ctx.measureText(label).width + 34;
        if (lx - w < P) { lx = R; y += 48; }
        ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(lx - 9, y - 10, 9, 0, Math.PI * 2); ctx.fill();
        text(ctx, label, lx - 26, y, F(500, 28), C.text);
        lx -= w + 30;
      });
      y += 80;
    }

    // الأكثر مبيعًا
    if (d.items.length) {
      text(ctx, "الأكثر مبيعًا", R, y, F(700, 34), C.text);
      y += 28;
      const rowH = 84;
      rr(ctx, P, y, inner, rowH * d.items.length + 16, 28); ctx.fillStyle = C.card; ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      d.items.forEach((it, i) => {
        const cy = y + 8 + i * rowH + rowH / 2;
        if (i) { ctx.fillStyle = C.line; ctx.fillRect(P + 28, y + 8 + i * rowH, inner - 56, 2); }
        ctx.fillStyle = i === 0 ? C.gold : C.bg; ctx.beginPath(); ctx.arc(R - 52, cy, 24, 0, Math.PI * 2); ctx.fill();
        text(ctx, String(i + 1), R - 52, cy + 10, F(800, 28), i === 0 ? "#241a0a" : C.muted, "center");
        const amount = money(it.m);
        ctx.font = F(800, 32);
        const aw = ctx.measureText(amount).width;
        text(ctx, amount, P + 32, cy + 11, F(800, 32), C.text, "left");
        const qty = `× ${whole(it.q)}`;
        ctx.font = F(500, 28);
        const qw = ctx.measureText(qty).width;
        text(ctx, qty, P + 32 + aw + 24, cy + 10, F(500, 28), C.muted, "left");
        ctx.font = F(700, 32);
        text(ctx, fit(ctx, it.name, inner - 100 - aw - qw - 90), R - 92, cy + 11, F(700, 32), C.text);
      });
      y += rowH * d.items.length + 16 + 70;
    }

    // تقفيل الخزينة لو انعمل
    if (d.closing) {
      const diff = Number(d.closing.difference);
      text(ctx, "تقفيل الخزينة", R, y, F(700, 34), C.text);
      y += 28;
      rr(ctx, P, y, inner, 150, 28); ctx.fillStyle = C.card; ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
      const cols = [
        { l: "المتوقع", v: money(d.closing.expected_closing), c: C.text },
        { l: "بالعدّ", v: money(d.closing.actual_closing), c: C.text },
        { l: diff === 0 ? "مضبوط" : diff < 0 ? "عجز" : "زيادة", v: money(Math.abs(diff)), c: diff < 0 ? C.red : C.olive },
      ];
      const cw = inner / 3;
      cols.forEach((c, i) => {
        const xr = R - i * cw - 32;
        text(ctx, c.l, xr, y + 56, F(700, 26), C.muted);
        text(ctx, c.v, xr, y + 112, F(800, 40), c.c);
      });
      y += 150 + 70;
    }

    if (!d.count) {
      text(ctx, "ما في مبيعات مسجّلة بهاليوم", W / 2, y + 20, F(700, 36), C.muted, "center");
      y += 90;
    }

    // التذييل
    ctx.fillStyle = C.line; ctx.fillRect(P, y, inner, 2);
    y += 56;
    const now = new Date().toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit", numberingSystem: "latn" });
    text(ctx, `OLV · طلع من برنامج المحاسبة الساعة ${now}`, W / 2, y, F(500, 26), C.muted, "center");
    y += 50;

    const out = document.createElement("canvas");
    out.width = W; out.height = Math.ceil(y);
    out.getContext("2d").drawImage(cv, 0, 0);
    return out;
  }

  function asText(d) {
    const L = [`تقرير ${d.date}`, `المبيعات: ${money(d.total)} (${whole(d.count)} فاتورة)`];
    if (d.expenses != null) L.push(`المصروفات: ${money(d.expenses)}`, `الصافي: ${money(d.total - d.expenses)}`);
    if (d.total > 0) L.push(`كاش ${money(d.cash)} · شبكة ${money(d.card)} · توصيل ${money(d.delivery)}`);
    if (d.items.length) L.push("الأكثر مبيعًا: " + d.items.map((i) => `${i.name} ×${whole(i.q)}`).join("، "));
    if (d.closing) L.push(`الخزينة: متوقع ${money(d.closing.expected_closing)} · بالعدّ ${money(d.closing.actual_closing)} · الفرق ${money(d.closing.difference)}`);
    return L.join("\n");
  }

  // ---------- النافذة ----------
  async function olvOpenDayReport(date) {
    date = date || olvToday();
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.className = "olv-dr-backdrop olv-modal-backdrop";
    backdrop.innerHTML = `<div class="olv-dr-modal" role="dialog" aria-modal="true" aria-labelledby="olv-dr-t">
      <h2 id="olv-dr-t">تقرير اليوم كصورة</h2>
      <div class="olv-dr-sub">ابعتها عالواتساب لشريكك أو احفظها عندك.</div>
      <div class="olv-dr-prev"><div class="olv-dr-wait">عم نجهّز الصورة…</div></div>
      <div class="olv-dr-err" hidden></div>
      <div class="olv-dr-actions">
        <button type="button" class="btn gold main" data-a="share" disabled>${olvIcon("share")}<span>شارك الصورة</span></button>
        <button type="button" class="btn" data-a="text" disabled>${olvIcon("clipboard")}<span>نسخ كنص</span></button>
        <button type="button" class="btn" data-a="close">${olvIcon("x")}<span>إغلاق</span></button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const $ = (s) => backdrop.querySelector(s);
    const close = () => { document.removeEventListener("keydown", onKey); window.olvDismiss ? olvDismiss(backdrop) : backdrop.remove(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    $('[data-a="close"]').addEventListener("click", close);

    let file = null, data = null;
    const canShareFiles = (f) => { try { return !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (_) { return false; } };
    try {
      data = await loadDay(date);
      const cv = await draw(data);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      file = new File([blob], `OLV-${date}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);
      $(".olv-dr-prev").innerHTML = `<img alt="تقرير ${olvEsc(date)}" src="${url}">`;
      const shareBtn = $('[data-a="share"]');
      if (!canShareFiles(file)) shareBtn.innerHTML = olvIcon("download") + "<span>تنزيل الصورة</span>";
      shareBtn.disabled = false;
      $('[data-a="text"]').disabled = false;
    } catch (err) {
      $(".olv-dr-prev").innerHTML = "";
      const e = $(".olv-dr-err");
      e.hidden = false;
      e.textContent = olvIsNetworkError(err) ? "ما في اتصال بالإنترنت، جرّب لما يرجع" : (err && err.message) || "تعذّر تجهيز التقرير";
      return;
    }

    $('[data-a="share"]').addEventListener("click", async () => {
      if (canShareFiles(file)) {
        try { await navigator.share({ files: [file], title: "تقرير " + date }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      olvToast("نزلت الصورة، ابعتها من الواتساب", { icon: "download" });
    });
    $('[data-a="text"]').addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(asText(data)); olvToast("انسخ التقرير، الصقه بالواتساب", { icon: "check" }); }
      catch (_) { olvToast("ما قدرنا ننسخ، جرّب مرة تانية", { type: "danger", icon: "warning" }); }
    });
  }

  window.olvOpenDayReport = olvOpenDayReport;
})();
