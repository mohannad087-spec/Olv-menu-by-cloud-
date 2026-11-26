// طباعة طلب الشراء (A4) بهوية OLV. بتفتح نافذة جديدة فيها الطلب جاهز للطباعة أو الحفظ PDF.
// الاستدعاء: olvPrintPurchaseOrder({ supplier:{name,phone}, lines:[{name,unit,qty,price}], notes })
// عمود السعر دايمًا موجود: إذا السعر فاضي بيضل الخانة فاضية للتعبئة بالقلم. الإجمالي بيطلع بس لو في سعر.
(function () {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

  function buildHtml(d, logoUrl) {
    const lines = d.lines || [];
    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // رقم الطلب: تاريخ + وقت (بدون عدّاد بقاعدة البيانات)
    const poNo = `PO-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    let total = 0, anyPrice = false;
    const rows = lines.map((l, i) => {
      const p = Number(l.price) || 0, q = Number(l.qty) || 0;
      const t = p * q; if (p > 0) { anyPrice = true; total += t; }
      return `<tr><td class="num c">${i + 1}</td><td class="name">${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="num q">${esc(l.qty)}</td>` +
        `<td class="num">${p > 0 ? fmt(p) : ""}</td><td class="num">${p > 0 ? fmt(t) : ""}</td></tr>`;
    }).join("");
    const totBox = anyPrice ? `<div class="tot"><span>الإجمالي التقديري</span><b><bdi>${fmt(total)}</bdi> دينار</b></div>` : "";
    const sup = d.supplier || {};
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(poNo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box;margin:0}
:root{--in:#4254e8;--vi:#5b47e6;--ink:#25223a;--mu:#625d78;--bg:#f3f2fb;--ln:#dcdaf0}
body{font-family:'Tajawal',sans-serif;color:var(--ink);width:210mm;min-height:297mm;padding:14mm 14mm 40mm;position:relative;background:#fff;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#4254e8,#5b47e6);border-radius:18px;padding:12px 16px;color:#fff}
.logo{background:#0b0a08;border-radius:14px;height:84px;padding:6px 10px;display:flex;align-items:center}.logo img{height:72px}
.shop b{display:block;font-size:20px;font-weight:800}.shop span{font-size:12px;opacity:.9}
.title{margin-right:auto;text-align:left}.title h1{font-size:30px;font-weight:800;line-height:1.1}.title div{font-size:12px;opacity:.9;margin-top:4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.box{border:1px solid var(--ln);border-radius:14px;padding:11px 14px;background:var(--bg)}
.box h3{font-size:11.5px;color:var(--in);font-weight:700;margin-bottom:6px}
.kv{display:flex;justify-content:space-between;gap:10px;padding:2.5px 0}.kv span{color:var(--mu)}.kv b{font-weight:700}
.ltr{direction:ltr;unicode-bidi:embed}.blank{flex:1;max-width:130px;border-bottom:1px dotted var(--mu);height:15px;align-self:flex-end}
table{width:100%;border-collapse:separate;border-spacing:0;margin-top:14px}
thead{display:table-header-group}tr{break-inside:avoid}
th{background:var(--ink);color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:right}
th:first-child{border-radius:0 12px 0 0}th:last-child{border-radius:12px 0 0 0}
td{padding:8px;border-bottom:1px solid var(--ln)}tbody tr:nth-child(even) td{background:#faf9ff}
.num{text-align:center;font-variant-numeric:tabular-nums}.c{width:30px;color:var(--mu)}.name{font-weight:700}.q{font-weight:800;color:var(--in);font-size:15px}
.sum{display:flex;gap:12px;margin-top:12px;break-inside:avoid}
.cnt{background:var(--bg);border:1px solid var(--ln);border-radius:14px;padding:10px 16px;display:flex;gap:10px;align-items:center}.cnt b{font-size:24px;font-weight:800;color:var(--in)}
.tot{margin-right:auto;background:var(--ink);color:#fff;border-radius:14px;padding:10px 18px;display:flex;gap:14px;align-items:center}.tot b{font-size:20px;font-weight:800}
.notes{margin-top:12px;border:1px solid var(--ln);border-radius:14px;padding:10px 14px;min-height:62px;break-inside:avoid}
.notes h3{font-size:11.5px;color:var(--in);margin-bottom:4px}.notes p{color:var(--mu);white-space:pre-wrap}
.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:28px;break-inside:avoid}
.sg{border-top:1.5px solid var(--ink);padding-top:6px;font-size:12px;color:var(--mu);text-align:center;height:56px}
</style></head><body>
<div class="top"><div class="logo"><img src="${esc(logoUrl)}" alt="OLV"></div>
<div class="shop"><b>OLV كافيه ومطعم</b><span>Luxury Café &amp; Restaurant</span></div>
<div class="title"><h1>طلب شراء</h1><div>Purchase Order</div></div></div>
<div class="meta">
<div class="box"><h3>بيانات الطلب</h3>
<div class="kv"><span>رقم الطلب</span><b class="ltr">${esc(poNo)}</b></div>
<div class="kv"><span>تاريخ الطلب</span><b class="ltr">${dateStr}</b></div>
<div class="kv"><span>التسليم المطلوب</span><b class="blank"></b></div></div>
<div class="box"><h3>المورّد</h3>
<div class="kv"><span>الاسم</span><b>${esc(sup.name)}</b></div>
<div class="kv"><span>الهاتف</span><b class="ltr">${esc(sup.phone)}</b></div></div></div>
<table><thead><tr><th class="num">#</th><th>المادة</th><th>الوحدة</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum"><div class="cnt"><span>عدد الأصناف</span><b>${lines.length}</b></div>${totBox}</div>
<div class="notes"><h3>ملاحظات</h3><p>${esc(d.notes || "")}</p></div>
<div class="sign"><div class="sg">توقيع المشتري</div><div class="sg">ختم المحل</div><div class="sg">استلام المورّد</div></div>
</body></html>`;
  }

  window.olvPrintPurchaseOrder = function (data) {
    // بنفتح النافذة بنفس ضغطة الزر حتى ما يحجبها المتصفح
    const w = window.open("", "_blank");
    if (!w) { if (window.olvToast) olvToast("المتصفح حجب نافذة الطباعة، اسمح بالنوافذ المنبثقة", { type: "danger" }); return; }
    const logo = new URL("assets/brand/olv-logo.png", location.href).href;
    w.document.open(); w.document.write(buildHtml(data, logo)); w.document.close();
    const go = () => { try { w.focus(); w.print(); } catch (e) { /* المستخدم يطبع يدويًا */ } };
    // ننتظر الخط والصورة، وإذا تأخروا نطبع بعد ثانيتين
    let done = false; const once = () => { if (!done) { done = true; go(); } };
    setTimeout(once, 2000);
    const img = w.document.querySelector(".logo img");
    Promise.all([w.document.fonts ? w.document.fonts.ready : null, img && !img.complete ? new Promise((r) => { img.onload = img.onerror = r; }) : null]).then(once, once);
  };
})();
