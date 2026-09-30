// طبقة Node فوق ticket-core.js: بتسجّل خط تجوال وبتعطي الـcore دالة إنشاء
// canvas من @napi-rs/canvas. الطباعة كصورة (وليس نصًا) تضمن ظهور العربية
// متصلة وصحيحة الاتجاه بغض النظر عن دعم الطابعة نفسها للغة العربية.
// (كل منطق الرسم والتصميم صار بـticket-core.js — نفسه بيشتغل بمعاينة المتصفح)

const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(__dirname, "..", "fonts", "Tajawal-Regular.ttf"), "Tajawal");
  GlobalFonts.registerFromPath(path.join(__dirname, "..", "fonts", "Tajawal-Bold.ttf"), "Tajawal-Bold");
  fontsRegistered = true;
}

function nodeCreateCanvas(width, height) {
  ensureFonts();
  return createCanvas(width, height);
}

// عرض قياسي لطابعات 80مم؛ للـ58مم اختر "58 ملم" من تخصيص الطابعة بالإعدادات
const PRINTER_WIDTH_PX = 576;

module.exports = { nodeCreateCanvas, PRINTER_WIDTH_PX };
