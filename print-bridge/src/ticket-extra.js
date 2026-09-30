const { TicketBuilder } = require("./ticket-builder");
const { formatTime, formatDateTime } = require("./format");

const BOLD = "Tajawal-Bold";
const REG = "Tajawal";

// تذكرة إلغاء: بتنطبع عند القسم اللي وصله الطلب أصلًا لما ينلغى (كامل أو
// صنف) بعد الطباعة — بخط كبير وواضح ومختلف عشان ما تنلخبط مع تذكرة تحضير
function buildCancelTicket(sale, stationName, items) {
  const t = new TicketBuilder();
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
  (items || []).forEach((item) => {
    t.right(`${item.qty}× ${item.product_name}`, `bold 32px ${BOLD}`, 42);
  });
  t.spacer(12);
  t.divider();
  t.spacer(4);
  return t.build();
}

// طباعة تجريبية للتأكد إن الطابعة موصولة وبتطبع عربي صح قبل الاعتماد عليها
function buildTestTicket(printer, target) {
  const t = new TicketBuilder();
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

module.exports = { buildCancelTicket, buildTestTicket };
