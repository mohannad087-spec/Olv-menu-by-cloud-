const { TicketBuilder } = require("./ticket-builder");
const { formatTime } = require("./format");

const BOLD = "Tajawal-Bold";
const REG = "Tajawal";

// يبني تذكرة مطبخ: تركّز على الأصناف والكميات والملاحظات فقط، بلا أسعار،
// وبخط كبير يسهل قراءته من بعيد في بيئة مطبخ مزدحمة
function buildKitchenTicket(sale) {
  const t = new TicketBuilder();
  t.center("طلب مطبخ", `bold 40px ${BOLD}`, 54);
  t.spacer(6);
  const meta = [sale.order_type, formatTime(sale.created_at)].filter(Boolean).join(" · ");
  t.center(meta, `26px ${REG}`, 36);
  t.spacer(10);
  t.divider();
  t.spacer(14);

  const items = sale.sale_items || [];
  items.forEach((item, idx) => {
    t.right(`${item.qty}× ${item.product_name}`, `bold 32px ${BOLD}`, 42);
    if (item.addons_summary) {
      t.right(`+ ${item.addons_summary}`, `24px ${REG}`, 32);
    }
    if (item.note) {
      t.right(`» ملاحظة: ${item.note}`, `bold 26px ${BOLD}`, 36);
    }
    if (idx < items.length - 1) t.spacer(10);
  });

  t.spacer(16);
  t.divider();
  t.spacer(10);
  t.center("-- انتهى الطلب --", `22px ${REG}`, 30);

  return t.build();
}

module.exports = { buildKitchenTicket };
