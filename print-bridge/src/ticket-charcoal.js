// بطاقة فحم الأرجيلة: بطاقة صغيرة (عرض الورق × حوالي 54 ملم) بتنطبع مع كل أرجيلة
// وبتتسلّم للموظف عند تبديل الفحم (مرة وحدة). الرقم = رقم الطلب والطاولة فهي فريدة.
const { nodeCreateCanvas, PRINTER_WIDTH_PX } = require("./ticket-builder");

function buildCharcoalCard(sale, index, total) {
  const W = PRINTER_WIDTH_PX, H = 380;
  const c = nodeCreateCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.textAlign = "center"; g.fillStyle = "#000"; g.textBaseline = "alphabetic";
  const STUB = 110; // الجزء الجانبي اللي بينقطع عند الاستخدام (يسار الورقة)
  // علامة مائية: OLV كبيرة مائلة بنقاط متباعدة (الطابعة أبيض/أسود فبنستعمل halftone)
  {
    const m = nodeCreateCanvas(W, H), mg = m.getContext("2d");
    mg.fillStyle = "#000"; mg.textAlign = "center"; mg.textBaseline = "middle";
    mg.translate(STUB + 6 + (W - STUB - 12) / 2, H / 2 + 6); mg.rotate(-0.22);
    mg.font = "bold 230px Tajawal-Bold"; mg.fillText("OLV", 0, 0);
    const d = mg.getImageData(0, 0, W, H).data;
    g.fillStyle = "#000";
    for (let y = 8; y < H - 8; y += 6) {
      for (let x = STUB + 10; x < W - 8; x += 6) {
        if (d[((y * W) + x) * 4 + 3] > 128) g.fillRect(x, y, 2, 2);
      }
    }
  }
  // إطار
  g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12);
  // خط القص المتقطع
  g.lineWidth = 3; g.setLineDash([12, 9]);
  g.beginPath(); g.moveTo(STUB + 6, 6); g.lineTo(STUB + 6, H - 6); g.stroke(); g.setLineDash([]);
  // نص الجزء الجانبي بشكل عمودي
  g.save(); g.translate(STUB / 2 + 14, H / 2); g.rotate(-Math.PI / 2);
  g.font = "bold 26px Tajawal-Bold"; g.fillText("✂ يُقطع عند الاستخدام", 0, 0); g.restore();
  const cx = STUB + 6 + (W - STUB - 12) / 2;
  g.font = "24px Tajawal"; g.fillText("OLV", cx, 52);
  g.font = "bold 58px Tajawal-Bold"; g.fillText("بطاقة فحم", cx, 122);
  g.lineWidth = 2; g.beginPath(); g.moveTo(STUB + 40, 140); g.lineTo(W - 40, 140); g.stroke();
  const where = sale.table_number ? `طاولة ${sale.table_number}` : (sale.order_type || "");
  g.font = "bold 34px Tajawal-Bold"; g.fillText(`${where ? where + " · " : ""}طلب #${sale.order_no || ""}`, cx, 192);
  if (total > 1) { g.font = "26px Tajawal"; g.fillText(`أرجيلة ${index} من ${total}`, cx, 232); }
  g.font = "bold 32px Tajawal-Bold"; g.fillText("تبديل فحم واحد — مرة وحدة", cx, 292);
  g.font = "22px Tajawal"; g.fillText(new Date(sale.created_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Amman" }).replace(",", "  "), cx, 340);
  return c;
}
module.exports = { buildCharcoalCard };
