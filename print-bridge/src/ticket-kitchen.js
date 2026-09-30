const core = require("./ticket-core");
const { nodeCreateCanvas } = require("./ticket-builder");

// تذكرة محطة تحضير (مطبخ/بار/أراجيل...): بلا أسعار وبخط كبير.
// stationName: اسم المحطة، hasOtherStations: الطلب معه أصناف بأقسام تانية،
// layout = ticket_layout المحفوظ للمحطة (null = الشكل الافتراضي)
function buildKitchenTicket(sale, stationName, hasOtherStations, layout) {
  return core.buildStation(nodeCreateCanvas, sale, stationName, hasOtherStations, layout);
}

module.exports = { buildKitchenTicket };
