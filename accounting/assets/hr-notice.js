// الموارد البشرية: «إشعار OLV» = نسخة الإنذار/الخصم/المكافأة بتنسيق المطعم كصورة PNG بختم OLV.
//   window.OLV_NOTICE.open(rec, emp, records): نافذة معاينة فيها طباعة، حفظ كصورة، وإرسال بالواتساب.
// الصورة بتتولّد بالمتصفح (مكتبة html2canvas المحلية بـassets/vendor، بتنحمّل أول ما تنفتح النافذة وبتشتغل أوفلاين) ومنها بتطلع الطباعة والمشاركة، فاللي بتشوفه هو اللي بيوصل.
(function () {
  const esc = (v) => olvEsc(v);
  const H = () => window.OLV_HR;
  const COLORS = { warning_verbal: "#3b6fe0", warning_written: "#e07b1f", warning_final: "#cf2f48", deduction: "#c93f8f", bonus: "#12908c" };
  const INK = [52, 58, 150]; // لون الختم (نيلي التطبيق)

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("تعذّر تحميل مكتبة الصورة")); document.head.appendChild(s); });
  }
  async function ensureH2C() {
    if (window.html2canvas) return;
    await loadScript("assets/vendor/html2canvas-1.4.1.min.js");
  }
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("تعذّر تحميل الشعار")); i.src = src; });
  }
  const assetBase = () => location.href.replace(/[^/]*$/, "").split("?")[0] + "assets/brand/";

  // ---------------------------------------------------------------- الختم: دائرة بحبر النيلي والشعار بالوسط
  let stampUrl = null;
  async function stampDataUrl() {
    if (stampUrl) return stampUrl;
    const S = 520, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d"), cx = S / 2, ink = `rgb(${INK.join(",")})`;
    x.strokeStyle = ink; x.fillStyle = ink; x.lineCap = "round";
    x.lineWidth = 12; x.beginPath(); x.arc(cx, cx, 246, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.arc(cx, cx, 230, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(cx, cx, 150, 0, Math.PI * 2); x.stroke();
    function arcText(t, r, mid, top) {
      x.font = "700 34px Tajawal, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      const step = 0.105, n = t.length, start = mid - ((n - 1) * step) / 2 * (top ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const a = top ? start + i * step : start - i * step;
        x.save(); x.translate(cx + Math.cos(a) * r, cx + Math.sin(a) * r); x.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2); x.fillText(t[i], 0, 0); x.restore();
      }
    }
    arcText("LUXURY CAFÉ & RESTAURANT", 190, -Math.PI / 2, true);
    arcText("AMMAN · JORDAN", 190, Math.PI / 2, false);
    [Math.PI * 0.0, Math.PI * 1.0].forEach((a) => { x.beginPath(); const px = cx + Math.cos(a) * 190, py = cx + Math.sin(a) * 190; x.moveTo(px, py - 11); x.lineTo(px + 11, py); x.lineTo(px, py + 11); x.lineTo(px - 11, py); x.closePath(); x.fill(); });
    // الشعار: الأسود يصير شفاف، والذهبي/الزيتوني يصير حبر
    try {
      const lg = await loadImg(assetBase() + "olv-logo-original.png");
      const sw = 1170, sh = 470, t = document.createElement("canvas"); t.width = 640; t.height = Math.round(640 * sh / sw);
      const tx = t.getContext("2d"); tx.drawImage(lg, 230, 470, sw, sh, 0, 0, t.width, t.height);
      const im = tx.getImageData(0, 0, t.width, t.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.max(d[i], d[i + 1], d[i + 2]), a = Math.max(0, Math.min(1, (lum - 38) / 70));
        d[i] = INK[0]; d[i + 1] = INK[1]; d[i + 2] = INK[2]; d[i + 3] = Math.round(a * 255);
      }
      tx.putImageData(im, 0, 0);
      const w = 262; x.drawImage(t, cx - w / 2, cx - (w * t.height / t.width) / 2 - 12, w, w * t.height / t.width);
    } catch (_) {
      x.font = "800 90px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("OLV", cx, cx - 12);
    }
    x.font = "800 30px Tajawal, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("ختم رسمي", cx, cx + 58);
    // خشونة الحبر
    const im2 = x.getImageData(0, 0, S, S), p = im2.data;
    for (let i = 3; i < p.length; i += 4) if (p[i] > 0) p[i] = Math.round(p[i] * (0.8 + Math.random() * 0.2) * (Math.random() < 0.015 ? 0.35 : 1));
    x.putImageData(im2, 0, 0);
    stampUrl = c.toDataURL("image/png");
    return stampUrl;
  }

  // ---------------------------------------------------------------- بطاقة الإشعار
  async function evidenceFor(rec) {
    if (rec.evidence && rec.evidence.length) return rec.evidence;
    if (rec.reason_code !== "late" || rec.kind === "bonus") return [];
    try {
      const m0 = String(rec.record_date).slice(0, 7) + "-01";
      return (await H().loadAttendance(rec.profile_id, m0, rec.record_date)).filter(H().isLateRow).map(H().toEv);
    } catch (_) { return []; }
  }

  function cardHtml(rec, emp, records, ev, stamp, logoUrl) {
    const h = H(), k = h.KINDS[rec.kind] || { label: "قرار" }, col = COLORS[rec.kind] || "#3b6fe0";
    const warn = h.isWarning(rec.kind);
    const nth = warn ? records.filter((r) => r.profile_id === rec.profile_id && r.status === "active" && h.isWarning(r.kind) && (r.record_date < rec.record_date || (r.record_date === rec.record_date && r.created_at <= rec.created_at))).length : 0;
    const title = warn ? `إشعار ${k.label}` : rec.kind === "deduction" ? "إشعار خصم مالي" : "شهادة مكافأة";
    const notes = [];
    if (rec.kind === "warning_final") notes.push("هذا الإنذار النهائي. أي مخالفة لاحقة بتعرّضه لإجراءات أشد قد توصل لإنهاء التعاقد.");
    if (rec.kind === "warning_written") notes.push("تكرار المخالفة بيؤدي لإنذار نهائي وإجراءات إضافية.");
    if (rec.kind === "warning_verbal") notes.push("هذا تنبيه رسمي أول موثّق، وتكرار المخالفة بيؤدي لإنذار خطي.");
    const money = Number(rec.amount) > 0
      ? `<div class="amt" style="color:${col}">${rec.kind === "bonus" ? "+" : "−"} ${olvFormatMoney(rec.amount)} <small>د.أ</small></div><div class="amt-s">${rec.kind === "bonus" ? "بتنضاف لراتبه" : "بينخصم من راتبه" + (Number(rec.deduct_days) ? ` (يشمل ${Number(rec.deduct_days)} يوم)` : "")}</div>` : "";
    const cancelled = rec.status === "cancelled" ? `<div class="void">ملغي</div>` : "";
    return `<style>
.nt{width:640px; background:#fbf8f1; color:#1f1d2b; font-family:Tajawal,Arial,sans-serif; direction:rtl; position:relative; overflow:hidden; border-radius:18px; border:2px solid #0f0e0a}
.nt *{box-sizing:border-box}
.nt .hd{background:#0f0e0a; display:flex; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:5px solid ${col}}
.nt .hd img{height:62px; display:block}
.nt .hd .tt{color:#e8c46a; text-align:right}
.nt .hd .tt b{display:block; font-size:28px; font-weight:800; line-height:1.2}
.nt .hd .tt span{font-size:14px; color:#cdbf94}
.nt .bd{padding:20px 26px 8px}
.nt .pill{display:inline-block; background:${col}; color:#fff; font-weight:800; font-size:16px; padding:4px 18px; border-radius:999px}
.nt .dt{float:left; color:#625d78; font-size:15px; padding-top:6px}
.nt .grid{margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:0; border:1px solid #d9d4c4; border-radius:12px; overflow:hidden; background:#fff}
.nt .grid div{padding:10px 14px; border-bottom:1px solid #eee9da; font-size:15px}
.nt .grid div:nth-child(odd){border-left:1px solid #eee9da}
.nt .grid div:nth-last-child(-n+2){border-bottom:0}
.nt .grid small{display:block; color:#7a7590; font-size:12px; margin-bottom:2px}
.nt .grid b{font-size:17px; font-weight:800}
.nt .why{margin-top:14px; font-size:17px; line-height:2; min-height:48px; white-space:pre-wrap}
.nt .amt{font-size:40px; font-weight:800; line-height:1.1; margin-top:6px}.nt .amt small{font-size:18px}
.nt .amt-s{color:#625d78; font-size:14px; margin-bottom:6px}
.nt .evt{margin-top:12px; border:1px solid #d9d4c4; border-radius:12px; overflow:hidden; background:#fff; font-size:14px}
.nt .evt .r{display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr; padding:7px 12px; border-top:1px solid #eee9da; text-align:center}
.nt .evt .r span:first-child{text-align:right}
.nt .evt .r.h{background:#f1ecdd; color:#625d78; font-weight:800; border-top:0; font-size:13px}
.nt .evt .r.abs span:last-child{color:#cf2f48; font-weight:800}
.nt .evt .r span:last-child{font-weight:800; color:${col}}
.nt .evt .r.h span:last-child{color:#625d78}
.nt .evt .tot{padding:8px 12px; background:#f6f2e6; font-size:14px; border-top:1px solid #eee9da}
.nt .evh{margin-top:14px; font-size:13px; font-weight:800; color:#625d78}
.nt .nts{margin-top:10px; font-size:14px; color:#3b3850; line-height:1.9}
.nt .sg{position:relative; height:150px; margin-top:8px; display:flex; justify-content:space-between; align-items:flex-end; padding:0 4px 14px}
.nt .sg .l{width:44%; text-align:center; font-size:14px; border-top:1.5px solid #1f1d2b; padding-top:6px; color:#3b3850}
.nt .sg .l small{display:block; color:#8a86a0; font-size:12px; margin-top:2px}
.nt .stamp{position:absolute; left:50%; top:-30px; margin-left:-86px; width:172px; height:172px; transform:rotate(-12deg); opacity:.93; mix-blend-mode:multiply}
.nt .ft{background:#0f0e0a; color:#cdbf94; font-size:12.5px; text-align:center; padding:8px}
.nt .void{position:absolute; top:46%; left:50%; transform:translate(-50%,-50%) rotate(-18deg); font-size:90px; font-weight:800; color:rgba(207,47,72,.28); border:8px solid rgba(207,47,72,.28); padding:0 28px; border-radius:16px}
</style>
<div class="nt">
  <div class="hd"><div class="tt"><b>${esc(title)}</b><span>OLV Luxury Café &amp; Restaurant</span></div><img src="${logoUrl}" alt="OLV"></div>
  <div class="bd">
    <div><span class="pill">${esc(k.label)}${nth ? ` · رقم ${nth}` : ""}</span><span class="dt">${esc(h.fmtDate(rec.record_date))}</span></div>
    <div class="grid">
      <div><small>اسم الموظف</small><b>${esc(emp.full_name || "")}</b></div>
      <div><small>المسمّى الوظيفي</small><b>${esc(emp.job_title || "—")}</b></div>
      <div><small>السبب</small><b>${esc(h.reasonLabel(rec.reason_code))}</b></div>
      <div><small>التاريخ</small><b>${esc(rec.record_date)}</b></div>
    </div>
    ${money}
    <div class="why">${esc(rec.reason_text || "")}</div>
    ${ev.length ? `<div class="evh">بصمات الدوام المرفقة</div><div class="evt"><div class="r h"><span>اليوم</span><span>الدوام</span><span>البصمة</span><span>${ev.some((x) => x.a) ? "الحالة" : "التأخير"}</span></div>${ev.slice().sort((a, b) => (a.d < b.d ? -1 : 1)).map((x) =>
      `<div class="r${x.a ? " abs" : ""}"><span>${esc(h.dayLabel(x.d))}</span><span>${h.fmtT(x.s)}</span><span>${x.a ? "بدون بصمة" : h.fmtT(x.p)}</span><span>${x.a ? "غياب" : Math.round(x.m) + " د"}</span></div>`).join("")}
      ${ev.some((x) => !x.a) ? `<div class="tot">مجموع التأخير: <b>${Math.round(ev.reduce((s, x) => s + (x.a ? 0 : Number(x.m) || 0), 0))} دقيقة</b> خلال ${ev.filter((x) => !x.a).length} أيام</div>` : ""}</div>` : ""}
    ${notes.length ? `<div class="nts">${notes.map(esc).join("<br>")}</div>` : ""}
    <div class="sg"><img class="stamp" src="${stamp}" alt=""><div class="l">توقيع الموظف<small>التاريخ: ____ / ____ / ______</small></div><div class="l">إدارة OLV<small>صاحب المطعم / المدير</small></div></div>
  </div>
  <div class="ft">وثيقة صادرة عن محاسبة OLV · نسخة للموظف ونسخة لملفه</div>
  ${cancelled}
</div>`;
  }

  async function renderPng(rec, emp, records) {
    await ensureH2C();
    const [stamp, ev] = await Promise.all([stampDataUrl(), evidenceFor(rec)]);
    const host = document.createElement("div");
    host.style.cssText = "position:fixed; left:-10000px; top:0; width:640px; z-index:-1";
    host.innerHTML = cardHtml(rec, emp, records, ev, stamp, assetBase() + "olv-logo.png");
    document.body.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all([...host.querySelectorAll("img")].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      const canvas = await window.html2canvas(host.querySelector(".nt"), { scale: 2, backgroundColor: null, useCORS: true, logging: false });
      return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("تعذّر توليد الصورة"))), "image/png"));
    } finally { host.remove(); }
  }

  const fileName = (rec, emp) => `OLV-${rec.kind}-${String(emp.full_name || "").trim().replace(/\s+/g, "-")}-${rec.record_date}.png`;
  const waPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); if (!d) return ""; return d.startsWith("962") ? d : d.startsWith("0") ? "962" + d.slice(1) : d; };

  // ---------------------------------------------------------------- نافذة المعاينة
  let dlg = null;
  async function open(rec, emp, records) {
    if (!dlg) { dlg = document.createElement("dialog"); dlg.className = "hr-dlg hr-ntdlg"; dlg.setAttribute("aria-labelledby", "hr-nt-title"); document.body.appendChild(dlg); }
    const k = H().KINDS[rec.kind] || { label: "قرار" };
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="dh"><h2 id="hr-nt-title">إشعار OLV · ${esc(k.label)}</h2><button type="button" class="btn small" data-x>إغلاق</button></div>
      <div class="db"><div class="hr-ntprev" id="hr-ntprev"><div class="hint">جاري تجهيز الصورة...</div></div><div class="derr" id="hr-nterr" role="alert"></div></div>
      <div class="df hr-ntacts"><button type="button" class="btn" id="nt-print" disabled>طباعة</button><button type="button" class="btn" id="nt-save" disabled>حفظ كصورة</button><button type="button" class="btn gold" id="nt-wa" disabled>إرسال بالواتساب</button></div>
    </form>`;
    const $ = (s) => dlg.querySelector(s);
    dlg.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => dlg.close()));
    dlg.showModal();
    let blob = null, url = null;
    dlg.addEventListener("close", () => { if (url) URL.revokeObjectURL(url); }, { once: true });
    try {
      blob = await renderPng(rec, emp, records);
      url = URL.createObjectURL(blob);
      $("#hr-ntprev").innerHTML = `<img src="${url}" alt="إشعار ${esc(k.label)}">`;
      ["#nt-print", "#nt-save", "#nt-wa"].forEach((s) => ($(s).disabled = false));
    } catch (e) { $("#hr-nterr").textContent = e.message || String(e); return; }
    const name = fileName(rec, emp);
    const download = () => { const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    $("#nt-save").addEventListener("click", () => { download(); olvToast("انحفظت الصورة", { type: "ok", icon: "check" }); });
    $("#nt-print").addEventListener("click", () => {
      const w = window.open("", "_blank");
      if (!w) { olvToast("المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة", { type: "danger", icon: "warning" }); return; }
      w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إشعار OLV</title><style>@page{size:A4; margin:12mm}body{margin:0;text-align:center}img{width:100%;max-width:170mm;display:block;margin:0 auto}</style></head><body><img src="${url}"><script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})<\/script></body></html>`);
      w.document.close();
    });
    $("#nt-wa").addEventListener("click", async () => {
      const text = `إشعار من إدارة OLV (${k.label}) بتاريخ ${rec.record_date}`;
      const file = new File([blob], name, { type: "image/png" });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      } catch (e) { if (e && e.name === "AbortError") return; }
      // مشاركة الملفات مش مدعومة بهالجهاز: نزّل الصورة وافتح واتساب، والصورة بتنرفق يدوي
      download();
      const ph = waPhone(emp.phone);
      window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, "_blank");
      olvToast("انحفظت الصورة. أرفقها بمحادثة الواتساب اللي انفتحت", { type: "info", icon: "check" });
    });
  }

  window.OLV_NOTICE = { open, cardHtml, renderPng, stampDataUrl };
})();
