// أداة بسيطة لبناء تذكرة/فاتورة كصورة (canvas) سطرًا بسطر، ثم تُحوَّل
// لاحقًا إلى صورة نقطية (raster) عبر escpos.js وتُرسل للطابعة. الطباعة
// كصورة (وليس نصًا) تضمن ظهور العربية متصلة وصحيحة الاتجاه بغض النظر
// عن دعم الطابعة نفسها للغة العربية.

const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(__dirname, "..", "fonts", "Tajawal-Regular.ttf"), "Tajawal");
  GlobalFonts.registerFromPath(path.join(__dirname, "..", "fonts", "Tajawal-Bold.ttf"), "Tajawal-Bold");
  fontsRegistered = true;
}

// عرض قياسي لطابعات 80مم (الأكثر شيوعًا في طابعات المطاعم الشبكية)
// إذا كانت طابعتك 58مم غيّر هذا الرقم إلى 384
const PRINTER_WIDTH_PX = 576;

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

class TicketBuilder {
  constructor(width = PRINTER_WIDTH_PX) {
    ensureFonts();
    this.width = width;
    this.margin = 24;
    this.contentWidth = width - this.margin * 2;
    this.ops = [];
    this.y = 24;
    // كانفس مؤقت فقط لقياس عرض النص قبل معرفة الارتفاع النهائي للتذكرة
    this._measure = createCanvas(width, 10).getContext("2d");
  }

  center(text, font, lineHeight) {
    this._measure.font = font;
    const lines = wrapText(this._measure, text, this.contentWidth);
    lines.forEach((line) => {
      this.ops.push({ type: "center", text: line, font, y: this.y });
      this.y += lineHeight;
    });
    return this;
  }

  right(text, font, lineHeight) {
    this._measure.font = font;
    const lines = wrapText(this._measure, text, this.contentWidth);
    lines.forEach((line) => {
      this.ops.push({ type: "right", text: line, font, y: this.y });
      this.y += lineHeight;
    });
    return this;
  }

  // سطر بعمودين: نص عربي من اليمين (اسم الصنف) ورقم/سعر من اليسار
  row(rightText, leftText, font, lineHeight) {
    this.ops.push({ type: "row", rightText, leftText, font, y: this.y });
    this.y += lineHeight;
    return this;
  }

  divider() {
    this.ops.push({ type: "divider", y: this.y });
    this.y += 18;
    return this;
  }

  spacer(px) {
    this.y += px;
    return this;
  }

  build() {
    const height = this.y + 20;
    const canvas = createCanvas(this.width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.width, height);
    ctx.fillStyle = "#000";

    for (const op of this.ops) {
      if (op.type === "divider") {
        ctx.beginPath();
        ctx.moveTo(this.margin, op.y);
        ctx.lineTo(this.width - this.margin, op.y);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.stroke();
        continue;
      }
      if (op.type === "center") {
        ctx.direction = "rtl";
        ctx.textAlign = "center";
        ctx.font = op.font;
        ctx.fillText(op.text, this.width / 2, op.y);
        continue;
      }
      if (op.type === "right") {
        ctx.direction = "rtl";
        ctx.textAlign = "right";
        ctx.font = op.font;
        ctx.fillText(op.text, this.width - this.margin, op.y);
        continue;
      }
      if (op.type === "row") {
        ctx.direction = "rtl";
        ctx.textAlign = "right";
        ctx.font = op.font;
        ctx.fillText(op.rightText, this.width - this.margin, op.y);
        ctx.direction = "ltr";
        ctx.textAlign = "left";
        ctx.fillText(op.leftText, this.margin, op.y);
        continue;
      }
    }
    return canvas;
  }
}

module.exports = { TicketBuilder, PRINTER_WIDTH_PX };
