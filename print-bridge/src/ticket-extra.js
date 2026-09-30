const core = require("./ticket-core");
const { nodeCreateCanvas } = require("./ticket-builder");

// تذكرة إلغاء: ثابتة عمدًا (أمان)، بتنطبع عند القسم اللي وصله الطلب أصلًا
function buildCancelTicket(sale, stationName, items, layout) {
  return core.buildCancel(nodeCreateCanvas, sale, stationName, items, layout);
}

// طباعة تجريبية للاتصال (بدون تصميم)
function buildTestTicket(printer, target) {
  return core.buildConnectionTest(nodeCreateCanvas, printer, target);
}

// طباعة تجريبية بتصميم الطابعة (نفس بيانات معاينة المتصفح بالضبط)
function buildLayoutSampleTicket(printer, settings, layout) {
  const sale = core.sampleSale(printer);
  if (printer && printer.kind === "station") {
    return core.buildStation(nodeCreateCanvas, sale, printer.name, true, layout);
  }
  return core.buildReceipt(nodeCreateCanvas, sale, settings, layout, null);
}

module.exports = { buildCancelTicket, buildTestTicket, buildLayoutSampleTicket };
