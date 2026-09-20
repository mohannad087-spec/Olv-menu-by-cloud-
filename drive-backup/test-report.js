// اختبار محلي لمنطق بناء تقرير Excel بدون أي اتصال شبكة حقيقي — بيانات
// وهمية تحاكي شكل صفوف Supabase الحقيقية
const { buildWorkbook } = require("./src/report");

const fakeData = {
  sales: [
    {
      id: "11111111-aaaa-bbbb-cccc-111111111111",
      created_at: "2026-09-19T12:30:00Z",
      order_type: "صالة",
      table_number: "5",
      customer_phone: null,
      customer_name: "أحمد",
      cash_amount: 11.0,
      card_amount: 0,
      delivery_amount: 0,
      status: "completed",
      sale_items: [
        { product_name: "برغر لحم", qty: 2, unit_price: 5.5, addons_total: 0, status: "completed" },
      ],
    },
    {
      id: "22222222-aaaa-bbbb-cccc-222222222222",
      created_at: "2026-09-19T13:15:00Z",
      order_type: "توصيل",
      table_number: null,
      customer_phone: "0791234567",
      customer_name: null,
      cash_amount: 0,
      card_amount: 8.5,
      delivery_amount: 0,
      status: "voided",
      sale_items: [
        { product_name: "بطاطا مقلية", qty: 1, unit_price: 2.0, addons_total: 0.5, status: "voided" },
        { product_name: "كولا", qty: 1, unit_price: 1.0, addons_total: 0, status: "voided" },
      ],
    },
  ],
  expenses: [
    { created_at: "2026-09-19T09:00:00Z", amount: 50, description: "فاتورة أسبوعية", expense_categories: { name: "مشتريات ومخزون" } },
  ],
};

(async () => {
  const wb = buildWorkbook("2026-09-19", fakeData, "Asia/Amman");
  const sheetNames = wb.worksheets.map((s) => s.name);
  console.log("أسماء الأوراق:", sheetNames.join(", "));
  console.log("ثلاث أوراق بالترتيب الصحيح:", JSON.stringify(sheetNames) === JSON.stringify(["ملخص", "المبيعات", "المصروفات"]) ? "PASS" : "FAIL");

  const summary = wb.getWorksheet("ملخص");
  const totalSalesRow = summary.getRows(1, summary.rowCount).find((r) => r.getCell(1).value === "إجمالي المبيعات");
  const netProfitRow = summary.getRows(1, summary.rowCount).find((r) => r.getCell(1).value === "صافي الربح");
  // البيع الملغى (٨.٥) ما لازم يدخل بالإجمالي — يفترض بس 11.00 (البيع المكتمل)
  console.log("إجمالي المبيعات (يفترض 11، يستثني الملغى):", totalSalesRow.getCell(2).value, totalSalesRow.getCell(2).value === 11 ? "PASS" : "FAIL");
  console.log("صافي الربح (يفترض 11 - 50 = -39):", netProfitRow.getCell(2).value, netProfitRow.getCell(2).value === -39 ? "PASS" : "FAIL");

  const salesSheet = wb.getWorksheet("المبيعات");
  console.log("عدد صفوف المبيعات (يفترض 1 هيدر + 3 أصناف = 4):", salesSheet.rowCount, salesSheet.rowCount === 4 ? "PASS" : "FAIL");
  const voidedRow = salesSheet.getRow(3);
  console.log("صف صنف من الطلب الملغى معلّم صح:", voidedRow.getCell(11).value, voidedRow.getCell(11).value === "ملغى" ? "PASS" : "FAIL");

  const expSheet = wb.getWorksheet("المصروفات");
  console.log("عدد صفوف المصروفات (يفترض 1 هيدر + 1 مصروف = 2):", expSheet.rowCount, expSheet.rowCount === 2 ? "PASS" : "FAIL");

  const outPath = "/tmp/test-report-output.xlsx";
  await wb.xlsx.writeFile(outPath);
  const fs = require("fs");
  const stats = fs.statSync(outPath);
  console.log("تم حفظ ملف Excel فعلي بنجاح، الحجم:", stats.size, "بايت", stats.size > 0 ? "PASS" : "FAIL");
})();
