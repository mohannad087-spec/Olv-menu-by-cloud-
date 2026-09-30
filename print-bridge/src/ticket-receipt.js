const { TicketBuilder } = require("./ticket-builder");
const { formatMoney, formatDateTime } = require("./format");

const BOLD = "Tajawal-Bold";
const REG = "Tajawal";

const PAYMENT_LABELS = {
  cash: "كاش",
  card: "شبكة / فيزا",
  delivery: "توصيل / تطبيقات",
};

function paymentMethodOf(sale) {
  if (Number(sale.cash_amount) > 0) return "cash";
  if (Number(sale.card_amount) > 0) return "card";
  if (Number(sale.delivery_amount) > 0) return "delivery";
  return null;
}

// يبني فاتورة الزبون/الكاشير: اسم المطعم، الأصناف مع الأسعار، الإجمالي،
// طريقة الدفع، والباقي في حال الدفع نقدًا
// reprint = { no, reason, by } لما تكون إعادة طباعة: شريط "نسخة مكررة" بأول
// الفاتورة وآخرها + سبب الإعادة واسم اللي أعادها ووقتها، حتى ما تنعطى
// للزبون نسخة تنقلب لفاتورة أصلية
function buildReceiptTicket(sale, settings, reprint) {
  const t = new TicketBuilder();
  const restaurantName = (settings && settings.restaurant_name) || "OLV";

  if (reprint) {
    t.center(`*** نسخة مكررة رقم ${reprint.no} ***`, `bold 30px ${BOLD}`, 42);
    t.divider();
    t.spacer(34);
  }

  t.center(restaurantName, `bold 38px ${BOLD}`, 50);
  if (settings && settings.restaurant_address) t.center(settings.restaurant_address, `20px ${REG}`, 28);
  if (settings && settings.restaurant_phone) t.center(settings.restaurant_phone, `20px ${REG}`, 28);
  if (sale.order_no) t.center(`طلب رقم ${sale.order_no}`, `bold 34px ${BOLD}`, 46);
  t.center(formatDateTime(sale.created_at), `22px ${REG}`, 32);
  const cashierName = sale.created_by_profile && sale.created_by_profile.full_name;
  if (cashierName) t.row("الكاشير", cashierName, `20px ${REG}`, 30);
  if (sale.order_type) t.center(sale.order_type, `22px ${REG}`, 32);
  if (sale.customer_name) t.row("اسم الزبون", String(sale.customer_name), `22px ${REG}`, 32);
  if (sale.table_number) t.row("رقم الطاولة", String(sale.table_number), `22px ${REG}`, 32);
  if (sale.customer_phone) t.row("هاتف الزبون", sale.customer_phone, `22px ${REG}`, 32);
  t.spacer(10);
  t.divider();
  t.spacer(14);

  // الأصناف الملغاة ما بتظهر بالفاتورة، والسعر يشمل الإضافات
  const items = (sale.sale_items || []).filter((it) => it.status !== "voided");
  const lineTotal = (it) => (Number(it.unit_price) + Number(it.addons_total || 0)) * Number(it.qty);
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const paid = Number(sale.cash_amount || 0) + Number(sale.card_amount || 0) + Number(sale.delivery_amount || 0);
  const discount = Number(sale.discount_amount || 0);
  const total = paid > 0 ? paid : Math.max(subtotal - discount, 0);

  items.forEach((item) => {
    t.row(`${item.qty}× ${item.product_name}`, formatMoney(lineTotal(item)), `26px ${REG}`, 36);
    if (item.addons_summary) {
      t.right(`+ ${item.addons_summary}`, `20px ${REG}`, 28);
    }
  });

  t.spacer(10);
  t.divider();
  t.spacer(14);
  if (discount > 0) {
    t.row("المجموع", formatMoney(subtotal), `24px ${REG}`, 34);
    t.row("الخصم", `- ${formatMoney(discount)}`, `24px ${REG}`, 34);
  }
  t.row("الإجمالي", formatMoney(total), `bold 32px ${BOLD}`, 44);

  const method = paymentMethodOf(sale);
  if (method) {
    t.row("طريقة الدفع", PAYMENT_LABELS[method] || method, `24px ${REG}`, 34);
  }
  if (method === "cash" && sale.cash_received != null) {
    t.row("المبلغ المستلم", formatMoney(sale.cash_received), `24px ${REG}`, 34);
    t.row("الباقي", formatMoney(sale.change_due), `bold 26px ${BOLD}`, 38);
  }

  t.spacer(16);
  t.divider();
  t.spacer(14);
  t.center("شكرًا لزيارتكم", `bold 26px ${BOLD}`, 36);

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

module.exports = { buildReceiptTicket };
