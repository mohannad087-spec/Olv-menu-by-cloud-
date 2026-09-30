const core = require("./ticket-core");
const { nodeCreateCanvas } = require("./ticket-builder");

// فاتورة الزبون/الكاشير. reprint = { no, reason, by } لإعادة الطباعة،
// layout = ticket_layout المحفوظ للطابعة (null = الشكل الافتراضي)
function buildReceiptTicket(sale, settings, reprint, layout) {
  return core.buildReceipt(nodeCreateCanvas, sale, settings, layout, reprint);
}

module.exports = { buildReceiptTicket };
