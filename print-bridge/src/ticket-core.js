// قلب بناء التذاكر — نفس الملف بيشتغل بمكانين:
//   • برنامج الطباعة (Node): بيرسم على @napi-rs/canvas ويطبع
//   • صفحة الإعدادات بالمتصفح: بيرسم المعاينة الحية على <canvas>
// فالمعاينة بتطلع مطابقة تمامًا للمطبوع (نفس الكود، نفس الخط، نفس القياسات).
//
// شكل كل تذكرة بيتحدد بـ"تصميم" (layout): كائن مسطّح { المفتاح: القيمة } لكل
// طابعة (جدول printers، عمود ticket_layout). أي مفتاح ناقص أو قيمته غير
// صالحة بيرجع لقيمته الافتراضية، والقيم الافتراضية = الشكل الأصلي بالضبط.
// مصدر الحقيقة الوحيد لكل الخيارات هو SCHEMA تحت (والواجهة بتنبني منه).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OlvTicketCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const BOLD = "Tajawal-Bold";
  const REG = "Tajawal";

  // ---------------------------------------------------------------------
  // التنسيق
  // ---------------------------------------------------------------------
  function formatMoney(n) { return Number(n || 0).toFixed(2); }
  // numberingSystem: "latn" = أرقام إنجليزية (0-9) بدل الهندية العربية
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", numberingSystem: "latn" });
  }
  function formatDateTime(ts) {
    return new Date(ts).toLocaleString("ar-EG", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", numberingSystem: "latn",
    });
  }

  // ---------------------------------------------------------------------
  // مخطط الخيارات (SCHEMA): كل مجموعة = عنوان + حقول
  // type: bool | text | textarea | number | select
  // ---------------------------------------------------------------------
  const PAPER_FIELD = {
    key: "paper", label: "عرض الورق", type: "select", def: "80",
    options: [["80", "80 ملم (الأشيع)"], ["58", "58 ملم"]],
  };

  const SCHEMA = {
    receipt: [
      { title: "الترويسة", fields: [
        { key: "head_name_show", label: "اسم المطعم", type: "bool", def: true },
        { key: "head_name_text", label: "نص بديل للاسم (فاضي = الاسم من الإعدادات)", type: "text", def: "", max: 60 },
        { key: "head_name_size", label: "حجم الاسم", type: "number", def: 38, min: 20, max: 64 },
        { key: "head_address_show", label: "العنوان", type: "bool", def: true },
        { key: "head_phone_show", label: "رقم الهاتف", type: "bool", def: true },
        { key: "head_extra", label: "أسطر إضافية تحت الاسم (كل سطر لحاله، مثل الرقم الضريبي)", type: "textarea", def: "", max: 300 },
        { key: "head_extra_size", label: "حجم الأسطر الإضافية", type: "number", def: 20, min: 14, max: 40 },
      ] },
      { title: "بيانات الطلب", fields: [
        { key: "order_no_show", label: "رقم الطلب", type: "bool", def: true },
        { key: "order_no_size", label: "حجم رقم الطلب", type: "number", def: 34, min: 20, max: 80 },
        { key: "datetime_show", label: "التاريخ والوقت", type: "bool", def: true },
        { key: "cashier_show", label: "اسم الكاشير", type: "bool", def: true },
        { key: "order_type_show", label: "نوع الطلب (صالة/سفري/توصيل)", type: "bool", def: true },
        { key: "customer_name_show", label: "اسم الزبون", type: "bool", def: true },
        { key: "table_show", label: "رقم الطاولة", type: "bool", def: true },
        { key: "phone_show", label: "هاتف الزبون", type: "bool", def: true },
        { key: "info_size", label: "حجم خط هذه البيانات", type: "number", def: 22, min: 16, max: 34 },
      ] },
      { title: "الأصناف", fields: [
        { key: "items_size", label: "حجم خط الأصناف", type: "number", def: 26, min: 18, max: 44 },
        { key: "items_prices_show", label: "أسعار الأصناف", type: "bool", def: true },
        { key: "items_addons_show", label: "الإضافات تحت الصنف", type: "bool", def: true },
        { key: "items_notes_show", label: "ملاحظات الأصناف", type: "bool", def: false },
      ] },
      { title: "المجاميع والدفع", fields: [
        { key: "discount_show", label: "المجموع والخصم (لما يكون في خصم)", type: "bool", def: true },
        { key: "total_size", label: "حجم الإجمالي", type: "number", def: 32, min: 22, max: 56 },
        { key: "payment_show", label: "طريقة الدفع", type: "bool", def: true },
        { key: "cash_received_show", label: "المبلغ المستلم والباقي (كاش)", type: "bool", def: true },
      ] },
      { title: "التذييل", fields: [
        { key: "footer_show", label: "عبارة الختام", type: "bool", def: true },
        { key: "footer_text", label: "نص الختام", type: "text", def: "شكرًا لزيارتكم", max: 80 },
        { key: "footer_size", label: "حجم الختام", type: "number", def: 26, min: 16, max: 44 },
        { key: "footer_extra", label: "أسطر إضافية بآخر الفاتورة (مثل: تابعونا على إنستغرام)", type: "textarea", def: "", max: 300 },
      ] },
      { title: "الورقة", fields: [
        PAPER_FIELD,
        { key: "dividers_show", label: "الخطوط الفاصلة", type: "bool", def: true },
      ] },
    ],
    station: [
      { title: "العنوان", fields: [
        { key: "title_show", label: "عنوان التذكرة", type: "bool", def: true },
        { key: "title_text", label: "نص العنوان ({station} = اسم المحطة)", type: "text", def: "طلب {station}", max: 60 },
        { key: "title_size", label: "حجم العنوان", type: "number", def: 40, min: 20, max: 70 },
        { key: "order_no_show", label: "رقم الطلب", type: "bool", def: true },
        { key: "order_no_size", label: "حجم رقم الطلب", type: "number", def: 56, min: 24, max: 100 },
      ] },
      { title: "معلومات الطلب", fields: [
        { key: "meta_type_show", label: "نوع الطلب (صالة/سفري/توصيل)", type: "bool", def: true },
        { key: "meta_time_show", label: "وقت الطلب", type: "bool", def: true },
        { key: "meta_date_show", label: "التاريخ مع الوقت", type: "bool", def: false },
        { key: "customer_name_show", label: "اسم الزبون", type: "bool", def: true },
        { key: "table_show", label: "رقم الطاولة", type: "bool", def: true },
        { key: "phone_show", label: "هاتف الزبون", type: "bool", def: true },
        { key: "cashier_show", label: "اسم الكاشير", type: "bool", def: false },
        { key: "info_size", label: "حجم خط هذه المعلومات", type: "number", def: 30, min: 18, max: 48 },
      ] },
      { title: "الأصناف", fields: [
        { key: "items_size", label: "حجم خط الأصناف", type: "number", def: 32, min: 20, max: 56 },
        { key: "items_addons_show", label: "الإضافات تحت الصنف", type: "bool", def: true },
        { key: "items_notes_show", label: "ملاحظات الأصناف", type: "bool", def: true },
      ] },
      { title: "التنبيهات والختام", fields: [
        { key: "other_station_show", label: "تنبيه \"معه طلب على قسم آخر\"", type: "bool", def: true },
        { key: "other_station_text", label: "نص التنبيه", type: "text", def: "+++ معه طلب على قسم آخر +++", max: 60 },
        { key: "footer_show", label: "عبارة الختام", type: "bool", def: true },
        { key: "footer_text", label: "نص الختام", type: "text", def: "-- انتهى الطلب --", max: 60 },
        { key: "footer_size", label: "حجم الختام", type: "number", def: 22, min: 14, max: 40 },
      ] },
      { title: "الورقة", fields: [
        PAPER_FIELD,
        { key: "dividers_show", label: "الخطوط الفاصلة", type: "bool", def: true },
      ] },
    ],
  };

  function fieldsOf(kind) {
    return SCHEMA[kind].reduce((all, g) => all.concat(g.fields), []);
  }

  function defaultLayout(kind) {
    const out = {};
    fieldsOf(kind).forEach((f) => { out[f.key] = f.def; });
    return out;
  }

  // يدمج التصميم المحفوظ مع الافتراضي ويتحقق من كل قيمة (نوع، حدود، طول)
  function resolveLayout(kind, raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = {};
    fieldsOf(kind).forEach((f) => {
      const v = src[f.key];
      if (f.type === "bool") out[f.key] = typeof v === "boolean" ? v : f.def;
      else if (f.type === "number") {
        const n = Number(v);
        out[f.key] = Number.isFinite(n) && v !== null && v !== "" ? Math.min(f.max, Math.max(f.min, Math.round(n))) : f.def;
      } else if (f.type === "select") {
        out[f.key] = f.options.some((o) => o[0] === v) ? v : f.def;
      } else {
        // text / textarea: نبقي الأسطر لـtextarea ونشيل رموز التحكم
        const s = typeof v === "string" ? v : f.def;
        // eslint-disable-next-line no-control-regex
        out[f.key] = s.replace(f.type === "textarea" ? /[\u0000-\u0009\u000b-\u001f]/g : /[\u0000-\u001f]/g, "").slice(0, f.max || 100);
      }
    });
    return out;
  }

  const PAPER_WIDTH = { "80": 576, "58": 384 };
  const widthFor = (layout) => PAPER_WIDTH[layout.paper] || 576;
  // يكبّر/يصغّر الخط والارتفاع بنسبة الحجم المختار للحجم الأصلي
  const scaled = (px, lh, k) => ({ px: Math.max(10, Math.round(px * k)), lh: Math.max(12, Math.round(lh * k)) });

  // ---------------------------------------------------------------------
  // مُنشئ التذكرة (سطرًا بسطر ثم رسم دفعة وحدة)
  // createCanvas(w, h) مُمرَّرة حسب البيئة (Node أو المتصفح)
  // ---------------------------------------------------------------------
  function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = word; }
      else current = test;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  class TicketBuilder {
    constructor(createCanvas, width, dividers) {
      this.createCanvas = createCanvas;
      this.width = width || 576;
      this.margin = 24;
      this.contentWidth = this.width - this.margin * 2;
      this.ops = [];
      this.dividers = dividers !== false;
      // أول سطر (عنوان بخط كبير) بينرسم على خط الأساس، فنبدأ من 50 عشان ما يتقص
      this.y = 50;
      this._measure = createCanvas(this.width, 10).getContext("2d");
    }
    _lines(text, font) {
      this._measure.font = font;
      return wrapText(this._measure, text, this.contentWidth);
    }
    _text(type, text, font, lh) {
      this._lines(text, font).forEach((line) => {
        this.ops.push({ type, text: line, font, y: this.y });
        this.y += lh;
      });
      return this;
    }
    center(text, font, lh) { return this._text("center", text, font, lh); }
    centerLtr(text, font, lh) { return this._text("center-ltr", text, font, lh); }
    right(text, font, lh) { return this._text("right", text, font, lh); }
    row(rightText, leftText, font, lh) {
      this.ops.push({ type: "row", rightText, leftText, font, y: this.y });
      this.y += lh;
      return this;
    }
    divider() {
      if (!this.dividers) { this.y += 6; return this; }
      this.ops.push({ type: "divider", y: this.y });
      this.y += 18;
      return this;
    }
    spacer(px) { this.y += px; return this; }

    build() {
      const height = this.y + 20;
      const canvas = this.createCanvas(this.width, height);
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
        } else if (op.type === "center" || op.type === "center-ltr") {
          ctx.direction = op.type === "center" ? "rtl" : "ltr";
          ctx.textAlign = "center";
          ctx.font = op.font;
          ctx.fillText(op.text, this.width / 2, op.y);
        } else if (op.type === "right") {
          ctx.direction = "rtl";
          ctx.textAlign = "right";
          ctx.font = op.font;
          ctx.fillText(op.text, this.width - this.margin, op.y);
        } else if (op.type === "row") {
          ctx.direction = "rtl";
          ctx.textAlign = "right";
          ctx.font = op.font;
          ctx.fillText(op.rightText, this.width - this.margin, op.y);
          ctx.direction = "ltr";
          ctx.textAlign = "left";
          ctx.fillText(op.leftText, this.margin, op.y);
        }
      }
      return canvas;
    }
  }

  const splitLines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

  // ---------------------------------------------------------------------
  // فاتورة الزبون/الكاشير
  // reprint = { no, reason, by } لما تكون إعادة طباعة (شريط "نسخة مكررة" ثابت
  // وغير قابل للتخصيص، حتى ما تنعطى نسخة تنقلب لفاتورة أصلية)
  // ---------------------------------------------------------------------
  const PAYMENT_LABELS = { cash: "كاش", card: "شبكة / فيزا", delivery: "توصيل / تطبيقات" };
  function paymentMethodOf(sale) {
    if (Number(sale.cash_amount) > 0) return "cash";
    if (Number(sale.card_amount) > 0) return "card";
    if (Number(sale.delivery_amount) > 0) return "delivery";
    return null;
  }

  function buildReceipt(createCanvas, sale, settings, layoutRaw, reprint) {
    const L = resolveLayout("receipt", layoutRaw);
    const t = new TicketBuilder(createCanvas, widthFor(L), L.dividers_show);
    const info = scaled(22, 32, L.info_size / 22);
    const infoSm = scaled(20, 30, L.info_size / 22);
    const restaurantName = L.head_name_text || (settings && settings.restaurant_name) || "OLV";

    if (reprint) {
      t.center(`*** نسخة مكررة رقم ${reprint.no} ***`, `bold 30px ${BOLD}`, 42);
      t.divider();
      t.spacer(34);
    }

    if (L.head_name_show) {
      const n = scaled(38, 50, L.head_name_size / 38);
      t.center(restaurantName, `bold ${n.px}px ${BOLD}`, n.lh);
    }
    if (L.head_address_show && settings && settings.restaurant_address) t.center(settings.restaurant_address, `20px ${REG}`, 28);
    if (L.head_phone_show && settings && settings.restaurant_phone) t.center(settings.restaurant_phone, `20px ${REG}`, 28);
    const ex = scaled(20, 28, L.head_extra_size / 20);
    const extraLines = splitLines(L.head_extra);
    extraLines.forEach((line) => t.center(line, `${ex.px}px ${REG}`, ex.lh));
    if (extraLines.length) t.spacer(6);

    if (L.order_no_show && sale.order_no) {
      const o = scaled(34, 46, L.order_no_size / 34);
      t.center(`طلب رقم ${sale.order_no}`, `bold ${o.px}px ${BOLD}`, o.lh);
    }
    if (L.datetime_show) t.center(formatDateTime(sale.created_at), `${info.px}px ${REG}`, info.lh);
    const cashierName = sale.created_by_profile && sale.created_by_profile.full_name;
    if (L.cashier_show && cashierName) t.row("الكاشير", cashierName, `${infoSm.px}px ${REG}`, infoSm.lh);
    if (L.order_type_show && sale.order_type) t.center(sale.order_type, `${info.px}px ${REG}`, info.lh);
    if (L.customer_name_show && sale.customer_name) t.row("اسم الزبون", String(sale.customer_name), `${info.px}px ${REG}`, info.lh);
    if (L.table_show && sale.table_number) t.row("رقم الطاولة", String(sale.table_number), `${info.px}px ${REG}`, info.lh);
    if (L.phone_show && sale.customer_phone) t.row("هاتف الزبون", sale.customer_phone, `${info.px}px ${REG}`, info.lh);
    t.spacer(10);
    t.divider();
    t.spacer(14 + Math.round(Math.max(0, scaled(26, 36, L.items_size / 26).px - 26) * 0.6));

    // الأصناف الملغاة ما بتظهر، والسعر يشمل الإضافات
    const items = (sale.sale_items || []).filter((it) => it.status !== "voided");
    const lineTotal = (it) => (Number(it.unit_price) + Number(it.addons_total || 0)) * Number(it.qty);
    const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
    const paid = Number(sale.cash_amount || 0) + Number(sale.card_amount || 0) + Number(sale.delivery_amount || 0);
    const discount = Number(sale.discount_amount || 0);
    const total = paid > 0 ? paid : Math.max(subtotal - discount, 0);

    const it = scaled(26, 36, L.items_size / 26);
    const itSub = scaled(20, 28, L.items_size / 26);
    items.forEach((item) => {
      const name = `${item.qty}× ${item.product_name}`;
      if (L.items_prices_show) t.row(name, formatMoney(lineTotal(item)), `${it.px}px ${REG}`, it.lh);
      else t.right(name, `${it.px}px ${REG}`, it.lh);
      if (L.items_addons_show && item.addons_summary) t.right(`+ ${item.addons_summary}`, `${itSub.px}px ${REG}`, itSub.lh);
      if (L.items_notes_show && item.note) t.right(`» ${item.note}`, `${itSub.px}px ${REG}`, itSub.lh);
      if (L.items_notes_show) t.spacer(6);
    });

    t.spacer(10);
    t.divider();
    t.spacer(14);
    const tk = L.total_size / 32;
    const row24 = scaled(24, 34, tk);
    const tot = scaled(32, 44, tk);
    const chg = scaled(26, 38, tk);
    if (L.discount_show && discount > 0) {
      t.row("المجموع", formatMoney(subtotal), `${row24.px}px ${REG}`, row24.lh);
      t.row("الخصم", `- ${formatMoney(discount)}`, `${row24.px}px ${REG}`, row24.lh);
    }
    t.row("الإجمالي", formatMoney(total), `bold ${tot.px}px ${BOLD}`, tot.lh);

    const method = paymentMethodOf(sale);
    if (L.payment_show && method) t.row("طريقة الدفع", PAYMENT_LABELS[method] || method, `${row24.px}px ${REG}`, row24.lh);
    if (L.cash_received_show && method === "cash" && sale.cash_received != null) {
      t.row("المبلغ المستلم", formatMoney(sale.cash_received), `${row24.px}px ${REG}`, row24.lh);
      t.row("الباقي", formatMoney(sale.change_due), `bold ${chg.px}px ${BOLD}`, chg.lh);
    }

    const fs = scaled(26, 36, L.footer_size / 26);
    const footerLines = splitLines(L.footer_extra);
    if ((L.footer_show && L.footer_text) || footerLines.length) {
      t.spacer(16);
      t.divider();
      t.spacer(14);
      if (L.footer_show && L.footer_text) t.center(L.footer_text, `bold ${fs.px}px ${BOLD}`, fs.lh);
      footerLines.forEach((line) => t.center(line, `${Math.max(14, Math.round(fs.px * 0.8))}px ${REG}`, Math.round(fs.lh * 0.85)));
    }

    if (reprint) {
      t.spacer(10);
      t.divider();
      t.spacer(10);
      t.center(`*** نسخة مكررة رقم ${reprint.no} — ليست أصلية ***`, `bold 24px ${BOLD}`, 34);
      t.right(`سبب الإعادة: ${reprint.reason}`, `22px ${REG}`, 32);
      if (reprint.by) t.row("أعادها", String(reprint.by), `22px ${REG}`, 32);
      t.center(`وقت الإعادة: ${formatDateTime(new Date())}`, `20px ${REG}`, 30);
    }
    return t.build();
  }

  // ---------------------------------------------------------------------
  // تذكرة محطة التحضير (مطبخ/بار/أراجيل...): بلا أسعار وبخط كبير
  // hasOtherStations: الطلب معه أصناف بأقسام تانية — بننبّه بدون ما نذكر شو هي
  // ---------------------------------------------------------------------
  function buildStation(createCanvas, sale, stationName, hasOtherStations, layoutRaw) {
    const L = resolveLayout("station", layoutRaw);
    const t = new TicketBuilder(createCanvas, widthFor(L), L.dividers_show);
    const ik = L.info_size / 30;

    if (L.title_show) {
      const title = (L.title_text || "طلب {station}").split("{station}").join(stationName || "مطبخ");
      const n = scaled(40, 54, L.title_size / 40);
      t.center(title, `bold ${n.px}px ${BOLD}`, n.lh);
    }
    if (L.order_no_show && sale.order_no) {
      const o = scaled(56, 72, L.order_no_size / 56);
      t.center(`#${sale.order_no}`, `bold ${o.px}px ${BOLD}`, o.lh);
    }
    t.spacer(6);
    const metaParts = [];
    if (L.meta_type_show && sale.order_type) metaParts.push(sale.order_type);
    if (L.meta_date_show) metaParts.push(formatDateTime(sale.created_at));
    else if (L.meta_time_show) metaParts.push(formatTime(sale.created_at));
    if (metaParts.length) {
      const m = scaled(26, 36, ik);
      t.center(metaParts.join(" · "), `${m.px}px ${REG}`, m.lh);
    }
    const big = scaled(30, 40, ik);
    const small = scaled(26, 36, ik);
    if (L.customer_name_show && sale.customer_name) t.center(sale.customer_name, `bold ${big.px}px ${BOLD}`, big.lh);
    if (L.table_show && sale.table_number) t.center(`طاولة رقم ${sale.table_number}`, `bold ${big.px}px ${BOLD}`, big.lh);
    if (L.phone_show && sale.customer_phone) t.centerLtr(sale.customer_phone, `bold ${small.px}px ${BOLD}`, small.lh);
    const cashierName = sale.created_by_profile && sale.created_by_profile.full_name;
    if (L.cashier_show && cashierName) t.center(`الكاشير: ${cashierName}`, `${small.px}px ${REG}`, small.lh);
    if (hasOtherStations && L.other_station_show && L.other_station_text) {
      t.spacer(8);
      t.center(L.other_station_text, `bold 28px ${BOLD}`, 40);
    }
    t.spacer(10);
    t.divider();
    t.spacer(14 + Math.round(Math.max(0, scaled(32, 42, L.items_size / 32).px - 32) * 0.6));

    const items = sale.sale_items || [];
    const k = L.items_size / 32;
    const it = scaled(32, 42, k);
    const ad = scaled(24, 32, k);
    const nt = scaled(26, 36, k);
    items.forEach((item, idx) => {
      t.right(`${item.qty}× ${item.product_name}`, `bold ${it.px}px ${BOLD}`, it.lh);
      if (L.items_addons_show && item.addons_summary) t.right(`+ ${item.addons_summary}`, `${ad.px}px ${REG}`, ad.lh);
      if (L.items_notes_show && item.note) t.right(`» ملاحظة: ${item.note}`, `bold ${nt.px}px ${BOLD}`, nt.lh);
      if (idx < items.length - 1) t.spacer(10);
    });

    t.spacer(16);
    t.divider();
    t.spacer(10);
    if (hasOtherStations && L.other_station_show && L.other_station_text) t.center(L.other_station_text, `bold 24px ${BOLD}`, 34);
    if (L.footer_show && L.footer_text) {
      const f = scaled(22, 30, L.footer_size / 22);
      t.center(L.footer_text, `${f.px}px ${REG}`, f.lh);
    }
    return t.build();
  }

  // تذكرة الإلغاء: ثابتة عمدًا (أمان — لازم تبقى واضحة ومختلفة عن تذكرة التحضير)،
  // بس بتاخد عرض ورق المحطة
  function buildCancel(createCanvas, sale, stationName, items, layoutRaw) {
    const L = resolveLayout("station", layoutRaw);
    const t = new TicketBuilder(createCanvas, widthFor(L), true);
    t.center("*** إلغاء ***", `bold 52px ${BOLD}`, 70);
    t.center(stationName ? `طلب ${stationName}` : "طلب مطبخ", `bold 30px ${BOLD}`, 42);
    t.spacer(8);
    t.divider();
    t.spacer(50);
    if (sale.order_no) t.center(`#${sale.order_no}`, `bold 56px ${BOLD}`, 72);
    const meta = [sale.order_type, formatTime(new Date().toISOString())].filter(Boolean).join(" · ");
    t.center(meta, `26px ${REG}`, 36);
    if (sale.table_number) t.center(`طاولة رقم ${sale.table_number}`, `bold 30px ${BOLD}`, 40);
    if (sale.customer_name) t.center(sale.customer_name, `bold 30px ${BOLD}`, 40);
    t.spacer(10);
    t.center("لا تحضّر الأصناف التالية:", `bold 26px ${BOLD}`, 38);
    t.spacer(6);
    (items || []).forEach((item) => t.right(`${item.qty}× ${item.product_name}`, `bold 32px ${BOLD}`, 42));
    t.spacer(12);
    t.divider();
    t.spacer(4);
    return t.build();
  }

  // طباعة تجريبية للاتصال (بدون تصميم): للتأكد إن الطابعة موصولة وبتطبع عربي
  function buildConnectionTest(createCanvas, printer, target) {
    const t = new TicketBuilder(createCanvas, 576, true);
    t.center("طباعة تجريبية", `bold 40px ${BOLD}`, 54);
    t.spacer(6);
    t.center(printer ? printer.name : "طابعة", `bold 34px ${BOLD}`, 46);
    t.centerLtr(`${target.ip}:${target.port || 9100}`, `26px ${REG}`, 36);
    t.center(formatDateTime(new Date().toISOString()), `24px ${REG}`, 34);
    t.spacer(10);
    t.divider();
    t.center("إذا قدرت تقرأ هالورقة، الطابعة شغّالة", `bold 26px ${BOLD}`, 38);
    return t.build();
  }

  // ---------------------------------------------------------------------
  // بيانات تجريبية للمعاينة والطباعة التجريبية (نفسها بالمتصفح وبالطابعة)
  // ---------------------------------------------------------------------
  const SAMPLE_ITEMS = [
    { id: "s1", qty: 2, product_name: "برغر لحم", category: "وجبات", unit_price: 10, addons_total: 1, addons_summary: "جبنة، بيكون", note: "بدون بصل" },
    { id: "s2", qty: 1, product_name: "شاورما دجاج", category: "وجبات", unit_price: 6.5, addons_total: 0, note: "زيادة ثوم" },
    { id: "s3", qty: 2, product_name: "موهيتو فراولة", category: "مشروبات", unit_price: 4, addons_total: 0, note: "بدون سكر" },
    { id: "s4", qty: 1, product_name: "أرجيلة تفاحتين", category: "أراجيل", unit_price: 8, addons_total: 1, addons_summary: "فحم إضافي" },
    { id: "s5", qty: 1, product_name: "كنافة", category: "حلويات", unit_price: 3.5, addons_total: 0 },
  ];

  // printerLike: { kind, categories, catch_unassigned }
  function sampleSale(printerLike) {
    const p = printerLike || { kind: "receipt" };
    let items;
    if (p.kind === "station") {
      const cats = p.categories || [];
      items = SAMPLE_ITEMS.filter((it) => cats.indexOf(it.category) !== -1);
      if (!items.length && cats.length) {
        items = [1, 2].map((n) => ({ id: "c" + n, qty: n, product_name: `${cats[0]} — صنف تجريبي ${n}`, category: cats[0], unit_price: 5, addons_total: 0, note: n === 1 ? "ملاحظة تجريبية" : "" }));
      } else if (!items.length) {
        items = SAMPLE_ITEMS.slice(0, 3);
      }
    } else {
      items = SAMPLE_ITEMS;
    }
    const subtotal = items.reduce((s, it) => s + (it.unit_price + (it.addons_total || 0)) * it.qty, 0);
    const discount = 2;
    return {
      order_no: 27, created_at: new Date().toISOString(), order_type: "صالة",
      customer_name: "أحمد", table_number: "5", customer_phone: "0791234567",
      created_by_profile: { full_name: "اسم الكاشير" },
      cash_amount: subtotal - discount, card_amount: 0, delivery_amount: 0, discount_amount: discount,
      cash_received: Math.ceil(subtotal / 5) * 5, change_due: Math.ceil(subtotal / 5) * 5 - (subtotal - discount),
      sale_items: items.map((it) => ({ status: "completed", ...it })),
    };
  }

  return {
    SCHEMA, resolveLayout, defaultLayout, TicketBuilder, PAPER_WIDTH,
    buildReceipt, buildStation, buildCancel, buildConnectionTest, sampleSale,
    formatMoney, formatTime, formatDateTime,
  };
});
