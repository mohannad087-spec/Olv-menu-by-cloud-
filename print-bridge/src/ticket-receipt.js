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
function buildReceiptTicket(sale, settings) {
  const t = new TicketBuilder();
  const restaurantName = (settings && settings.restaurant_name) || "OLV";

  t.center(restaurantName, `bold 38px ${BOLD}`, 50);
  t.center(formatDateTime(sale.created_at), `22px ${REG}`, 32);
  if (sale.order_type) t.center(sale.order_type, `22px ${REG}`, 32);
  t.spacer(10);
  t.divider();
  t.spacer(14);

  const items = sale.sale_items || [];
  const total = items.reduce((s, it) => s + Number(it.unit_price) * Number(it.qty), 0);

  items.forEach((item) => {
    t.row(`${item.qty}× ${item.product_name}`, formatMoney(Number(item.unit_price) * Number(item.qty)), `26px ${REG}`, 36);
    if (item.addons_summary) {
      t.right(`+ ${item.addons_summary}`, `20px ${REG}`, 28);
    }
  });

  t.spacer(10);
  t.divider();
  t.spacer(14);
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

  return t.build();
}

module.exports = { buildReceiptTicket };
