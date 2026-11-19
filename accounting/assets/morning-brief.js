// ملخص الصباح للمالك: أرقام أمس + اللي لازم ينتبه له اليوم، جاهز كنص للواتساب.
//   olvOpenMorningBrief()  ← بيجيب (مبيعات أمس مقابل نفس اليوم الأسبوع الماضي، مصروفات، صافي،
//                            إلغاءات وخصومات، تقفيل الخزينة، الناقص بالمخزون، ديون الموردين)
//                            وبيفتح نافذة فيها النص و«ابعت واتساب» و«نسخ»
// قراءة بس، ما بيغيّر شي. الإرسال التلقائي كل صباح بدون ما حدا يفتح البرنامج مش ممكن
// بدون خدمة واتساب للأعمال، فهاد الزر هو الطريقة الجاهزة.
(function () {
  const money = (n) => olvFormatMoney(n);
  const shift = (dateStr, d) => {
    const t = new Date(dateStr + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + d);
    return t.toISOString().slice(0, 10);
  };
  const total = (r) => (Number(r.cash_amount) || 0) + (Number(r.card_amount) || 0) + (Number(r.delivery_amount) || 0);

  function injectStyles() {
    if (document.getElementById("olv-mb-style")) return;
    const st = document.createElement("style");
    st.id = "olv-mb-style";
    st.textContent = `
      .olv-mb-backdrop{position:fixed; inset:0; background:rgba(8,7,4,.6); backdrop-filter:blur(6px); z-index:200;
        display:flex; align-items:center; justify-content:center; padding:16px;}
      .olv-mb-modal{width:100%; max-width:460px; max-height:92vh; display:flex; flex-direction:column; gap:12px;
        background:var(--ink-2); border:1px solid var(--hair); border-radius:20px; padding:18px;
        box-shadow:0 24px 60px rgba(0,0,0,.5); color:var(--paper); font-family:'Tajawal',sans-serif;}
      .olv-mb-modal h2{font-size:18px; margin:0;}
      .olv-mb-sub{color:var(--muted); font-size:13px; line-height:1.6;}
      .olv-mb-text{flex:1; min-height:0; overflow-y:auto; white-space:pre-wrap; line-height:1.9; font-size:14.5px;
        padding:14px; border-radius:14px; border:1px solid var(--hair-soft); background:var(--ink-3);}
      .olv-mb-err{color:var(--danger-hi); font-size:13px;}
      .olv-mb-actions{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
      .olv-mb-actions .btn{min-height:46px; justify-content:center;}
      .olv-mb-actions .main{grid-column:1 / -1;}
    `;
    document.head.appendChild(st);
  }

  async function load() {
    const db = window.supabaseClient;
    const day = shift(olvToday(), -1), prev = shift(day, -7);
    const [sR, eR, cR, lR, bR] = await Promise.allSettled([
      db.from("sales_entries").select("entry_date, status, discount_amount, cash_amount, card_amount, delivery_amount")
        .in("entry_date", [day, prev]).limit(5000),
      olvExpensesPaid(db, "amount", day, day),
      db.from("cash_closings").select("difference, created_at").eq("closing_date", day).order("created_at", { ascending: false }).limit(1),
      db.from("low_stock_items").select("name"),
      db.from("supplier_balances").select("balance"),
    ]);
    const ok = (r) => (r.status === "fulfilled" && !r.value.error ? r.value.data || [] : null);
    const sales = ok(sR);
    if (!sales) throw (sR.value && sR.value.error) || sR.reason || new Error("تعذّر جلب المبيعات");
    const d = { day, prev, sales: 0, count: 0, prevSales: 0, voids: 0, voidVal: 0, disc: 0 };
    sales.forEach((s) => {
      const t = total(s);
      if (s.entry_date === prev) { if (s.status !== "voided") d.prevSales += t; return; }
      if (s.status === "voided") { d.voids++; d.voidVal += t; return; }
      d.sales += t; d.count++; d.disc += Number(s.discount_amount) || 0;
    });
    const exp = ok(eR);
    d.expenses = exp ? exp.reduce((s, r) => s + (Number(r.amount) || 0), 0) : null;
    const cl = ok(cR);
    d.closing = cl && cl[0] ? cl[0] : cl ? false : null; // false = ما انقفلت، null = ما في صلاحية
    const low = ok(lR);
    d.low = low ? [...new Set(low.map((x) => x.name))] : null;
    const bal = ok(bR);
    d.debt = bal ? bal.reduce((s, b) => s + Math.max(0, Number(b.balance) || 0), 0) : null;
    d.debtN = bal ? bal.filter((b) => Number(b.balance) > 0.005).length : 0;
    d.backup = null;
    if (window.olvLoadBackupStatus) { try { d.backup = await olvLoadBackupStatus(); } catch (_) {} }
    return d;
  }

  function asText(d) {
    const dt = new Date(d.day + "T12:00:00Z");
    const name = dt.toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long", numberingSystem: "latn", timeZone: "UTC" });
    const L = [`صباح الخير ☀️`, `ملخص أمس (${name}):`, ""];
    L.push(`المبيعات: ${money(d.sales)} (${d.count} طلب)`);
    if (d.prevSales > 0) {
      const p = Math.round((d.sales - d.prevSales) / d.prevSales * 100);
      L.push(`مقارنة بنفس اليوم الأسبوع الماضي: ${p === 0 ? "نفسه" : (p > 0 ? "+" : "−") + Math.abs(p) + "%"}`);
    }
    if (d.expenses != null) L.push(`المصروفات: ${money(d.expenses)}`, `الصافي: ${money(d.sales - d.expenses)}`);
    if (d.voids || d.disc) L.push(`ملغاة: ${d.voids} (${money(d.voidVal)}) · خصومات: ${money(d.disc)}`);
    if (d.closing === false) L.push("الخزينة: ما انقفلت أمس ⚠️");
    else if (d.closing) {
      const df = Number(d.closing.difference) || 0;
      L.push(Math.abs(df) < 0.005 ? "الخزينة: مزبوطة ✅" : `الخزينة: ${df < 0 ? "عجز" : "زيادة"} ${money(Math.abs(df))} ${df < 0 ? "⚠️" : ""}`.trim());
    }
    L.push("");
    L.push("اليوم لازم تنتبه لـ:");
    if (d.low && d.low.length) L.push(`• ناقص بالمخزون (${d.low.length}): ${d.low.slice(0, 4).join("، ")}${d.low.length > 4 ? "…" : ""}`);
    else if (d.low) L.push("• المخزون مزبوط، ما في ناقص");
    if (d.debt != null) L.push(d.debt > 0 ? `• ديون الموردين: ${money(d.debt)} (${d.debtN} مورد)` : "• ما في ديون للموردين");
    if (d.backup && (d.backup.state === "failed" || d.backup.state === "old")) L.push(`• ⚠️ النسخة الاحتياطية: ${d.backup.text}`);
    return L.join("\n");
  }

  async function olvOpenMorningBrief() {
    injectStyles();
    const backdrop = document.createElement("div");
    backdrop.className = "olv-mb-backdrop olv-modal-backdrop";
    backdrop.innerHTML = `<div class="olv-mb-modal" role="dialog" aria-modal="true" aria-labelledby="olv-mb-t">
      <h2 id="olv-mb-t">ملخص الصباح</h2>
      <div class="olv-mb-sub">أرقام أمس واللي لازم تنتبه له اليوم. ابعته عالواتساب أو انسخه.</div>
      <div class="olv-mb-text" id="olv-mb-body">عم نجهّز الملخص…</div>
      <div class="olv-mb-err" hidden></div>
      <div class="olv-mb-actions">
        <button type="button" class="btn gold main" data-a="wa" disabled>${olvIcon("message")}<span>ابعت عالواتساب</span></button>
        <button type="button" class="btn" data-a="text" disabled>${olvIcon("clipboard")}<span>نسخ</span></button>
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

    let txt = "";
    try {
      txt = asText(await load());
    } catch (err) {
      $("#olv-mb-body").textContent = "";
      const e = $(".olv-mb-err");
      e.hidden = false;
      e.textContent = olvIsNetworkError(err) ? "ما في اتصال بالإنترنت، جرّب لما يرجع" : (err && err.message) || "تعذّر تجهيز الملخص";
      return;
    }
    $("#olv-mb-body").textContent = txt;
    $('[data-a="wa"]').disabled = false;
    $('[data-a="text"]').disabled = false;
    $('[data-a="wa"]').addEventListener("click", () => window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener"));
    $('[data-a="text"]').addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(txt); olvToast("اننسخ الملخص", { icon: "check" }); }
      catch (_) { olvToast("ما قدرنا ننسخ، جرّب مرة تانية", { type: "danger", icon: "warning" }); }
    });
  }

  window.olvOpenMorningBrief = olvOpenMorningBrief;
})();
