const ExcelJS = require("exceljs");
const { supabase } = require("./supabase");

async function fetchDayData(dateStr) {
  const { data: sales, error: salesErr } = await supabase
    .from("sales_entries")
    .select("*, sale_items(*)")
    .eq("entry_date", dateStr)
    .order("created_at", { ascending: true });
  if (salesErr) throw salesErr;

  const { data: expenses, error: expErr } = await supabase
    .from("expenses")
    .select("*, expense_categories(name)")
    .eq("expense_date", dateStr)
    .order("created_at", { ascending: true });
  if (expErr) throw expErr;

  return { sales: sales || [], expenses: expenses || [] };
}

function formatDateTime(ts, timeZone) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ar-EG", { timeZone, numberingSystem: "latn" });
}

function buildWorkbook(dateStr, { sales, expenses }, timeZone) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "محاسبة OLV";
  wb.created = new Date();

  const completedSales = sales.filter((s) => s.status !== "voided");
  const totalCash = completedSales.reduce((s, r) => s + Number(r.cash_amount || 0), 0);
  const totalCard = completedSales.reduce((s, r) => s + Number(r.card_amount || 0), 0);
  const totalDelivery = completedSales.reduce((s, r) => s + Number(r.delivery_amount || 0), 0);
  const totalSales = totalCash + totalCard + totalDelivery;
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const netProfit = totalSales - totalExpenses;
  const voidedCount = sales.length - completedSales.length;

  // ---- ورقة الملخص ----
  const summary = wb.addWorksheet("ملخص", { views: [{ rightToLeft: true }] });
  summary.columns = [{ width: 30 }, { width: 20 }];
  summary.addRow(["تقرير يومي شامل — محاسبة OLV"]).font = { bold: true, size: 14 };
  summary.addRow(["التاريخ", dateStr]);
  summary.addRow([]);
  const moneyRows = [
    ["إجمالي المبيعات (كاش)", totalCash],
    ["إجمالي المبيعات (شبكة)", totalCard],
    ["إجمالي المبيعات (توصيل)", totalDelivery],
    ["إجمالي المبيعات", totalSales],
    ["إجمالي المصروفات", totalExpenses],
    ["صافي الربح", netProfit],
  ];
  moneyRows.forEach(([label, value]) => {
    const row = summary.addRow([label, value]);
    row.getCell(2).numFmt = "#,##0.00";
  });
  summary.addRow([]);
  summary.addRow(["عدد الطلبات المكتملة", completedSales.length]);
  summary.addRow(["عدد الطلبات الملغاة", voidedCount]);
  summary.addRow(["عدد سطور المصروفات", expenses.length]);

  // ---- ورقة المبيعات التفصيلية (سطر لكل صنف داخل كل طلب) ----
  const salesSheet = wb.addWorksheet("المبيعات", { views: [{ rightToLeft: true }] });
  salesSheet.columns = [
    { header: "وقت الطلب", key: "time", width: 18 },
    { header: "رقم الطلب", key: "order", width: 12 },
    { header: "نوع الطلب", key: "type", width: 12 },
    { header: "الطاولة/الهاتف/الاسم", key: "meta", width: 26 },
    { header: "الصنف", key: "item", width: 26 },
    { header: "الكمية", key: "qty", width: 10 },
    { header: "سعر الوحدة", key: "unit", width: 12 },
    { header: "الإضافات", key: "addons", width: 12 },
    { header: "طريقة الدفع", key: "method", width: 14 },
    { header: "المبلغ", key: "amount", width: 12 },
    { header: "الحالة", key: "status", width: 12 },
  ];
  salesSheet.getRow(1).font = { bold: true };

  sales.forEach((sale) => {
    const method = Number(sale.cash_amount) > 0 ? "كاش"
      : Number(sale.card_amount) > 0 ? "شبكة"
      : Number(sale.delivery_amount) > 0 ? "توصيل" : "";
    const meta = [
      sale.table_number ? `طاولة ${sale.table_number}` : "",
      sale.customer_phone || "",
      sale.customer_name || "",
    ].filter(Boolean).join(" / ");
    const items = sale.sale_items && sale.sale_items.length ? sale.sale_items : [null];
    items.forEach((item) => {
      const row = salesSheet.addRow({
        time: formatDateTime(sale.created_at, timeZone),
        order: sale.id ? sale.id.slice(0, 8) : "",
        type: sale.order_type || "",
        meta,
        item: item ? item.product_name : "(بدون تفاصيل أصناف)",
        qty: item ? item.qty : "",
        unit: item ? item.unit_price : "",
        addons: item ? item.addons_total : "",
        method,
        amount: item ? (Number(item.unit_price || 0) + Number(item.addons_total || 0)) * Number(item.qty || 0) : "",
        status: (item ? item.status : sale.status) === "voided" ? "ملغى" : "مكتمل",
      });
      ["unit", "addons", "amount"].forEach((k) => { row.getCell(salesSheet.getColumn(k).number).numFmt = "#,##0.00"; });
    });
  });

  // ---- ورقة المصروفات ----
  const expSheet = wb.addWorksheet("المصروفات", { views: [{ rightToLeft: true }] });
  expSheet.columns = [
    { header: "الوقت", key: "time", width: 18 },
    { header: "التصنيف", key: "cat", width: 22 },
    { header: "الوصف", key: "desc", width: 32 },
    { header: "المبلغ", key: "amount", width: 12 },
  ];
  expSheet.getRow(1).font = { bold: true };
  expenses.forEach((e) => {
    const row = expSheet.addRow({
      time: formatDateTime(e.created_at, timeZone),
      cat: e.expense_categories ? e.expense_categories.name : "",
      desc: e.description || "",
      amount: e.amount,
    });
    row.getCell(expSheet.getColumn("amount").number).numFmt = "#,##0.00";
  });

  return wb;
}

module.exports = { fetchDayData, buildWorkbook };
