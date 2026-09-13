// أوامر ESC/POS الأساسية + تحويل صورة Canvas إلى صورة نقطية (raster) تفهمها
// الطابعات الحرارية. نطبع كصورة بالكامل (وليس نصًا) حتى تظهر العربية بشكل
// صحيح ومتصل الحروف بغض النظر عن دعم الطابعة لصفحة الرموز العربية.

const ESC = 0x1b;
const GS = 0x1d;

const INIT = Buffer.from([ESC, 0x40]); // إعادة ضبط الطابعة
const FEED_LINES = (n) => Buffer.from([ESC, 0x64, n]); // تغذية ورق
const CUT = Buffer.from([GS, 0x56, 0x42, 0x00]); // قص الورق (جزئي)

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
function buildTicketBuffer(canvas) {
  return Buffer.concat([
    INIT,
    canvasToRaster(canvas),
    FEED_LINES(4),
    CUT,
  ]);
}

module.exports = { canvasToRaster, buildTicketBuffer };
