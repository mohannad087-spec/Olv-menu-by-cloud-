// أوامر ESC/POS الأساسية + تحويل صورة Canvas إلى صورة نقطية (raster) تفهمها
// الطابعات الحرارية. نطبع كصورة بالكامل (وليس نصًا) حتى تظهر العربية بشكل
// صحيح ومتصل الحروف بغض النظر عن دعم الطابعة لصفحة الرموز العربية.

const ESC = 0x1b;
const GS = 0x1d;

const INIT = Buffer.from([ESC, 0x40]); // إعادة ضبط الطابعة
const FEED_LINES = (n) => Buffer.from([ESC, 0x64, n]); // تغذية ورق
const CUT = Buffer.from([GS, 0x56, 0x42, 0x00]); // قص الورق (جزئي)

// نبضة فتح درج الكاش (ESC p): بنبعتها على المخرجين (0 و1) لأن الدرج ممكن
// يكون موصول على أي منهم حسب الطابعة. نبضة 50ms ثم 500ms راحة
const DRAWER_KICK = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa, ESC, 0x70, 0x01, 0x19, 0xfa]);

// يحوّل عنصر canvas (من napi-rs/canvas) إلى أمر GS v 0 (طباعة صورة نقطية)
// كل بكسل أغمق من العتبة يُعتبر نقطة سوداء
function canvasToRaster(canvas, threshold = 160) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);
  const raster = Buffer.alloc(widthBytes * height, 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const luminance = a === 0 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < threshold) {
        const byteIndex = y * widthBytes + (x >> 3);
        raster[byteIndex] |= 0x80 >> (x % 8);
      }
    }
  }

  const header = Buffer.from([
    GS, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  return Buffer.concat([header, raster]);
}

// يبني رسالة الطباعة الكاملة الجاهزة للإرسال إلى الطابعة عبر TCP
// copies > 1: نفس التذكرة تنطبع عدة مرات بإرسال واحد (قص بين كل نسخة)، فإما تنطبع كلها أو تنعاد المهمة
function buildTicketBuffer(canvas, openDrawer = false, copies = 1) {
  const raster = canvasToRaster(canvas);
  const one = Buffer.concat([INIT, raster, FEED_LINES(4), CUT]);
  const n = Math.max(1, Math.min(5, Math.floor(copies) || 1));
  return Buffer.concat([...Array(n).fill(one), ...(openDrawer ? [DRAWER_KICK] : [])]);
}

// عدد نسخ تذكرة القسم (المطبخ/البار...)؛ الافتراضي نسختين، وممكن تغييره بـ KITCHEN_COPIES بملف .env
function kitchenCopies() {
  const n = Number(process.env.KITCHEN_COPIES || 2);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.floor(n))) : 2;
}

// عدد نسخ فاتورة البيع (طابعة الكاشير)؛ الافتراضي نسختين، وممكن تغييره بـ RECEIPT_COPIES بملف .env
function receiptCopies() {
  const n = Number(process.env.RECEIPT_COPIES || 2);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.floor(n))) : 2;
}

// فحص الدرج: بس أمر الفتح بدون ورقة
function buildDrawerBuffer() {
  return Buffer.concat([INIT, DRAWER_KICK]);
}

module.exports = { canvasToRaster, buildTicketBuffer, kitchenCopies, receiptCopies, buildDrawerBuffer };
