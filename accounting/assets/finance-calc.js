// دوال حساب نقية (بدون شاشة ولا قاعدة بيانات) للمبيعات والمصروفات والرواتب.
// مفصولة عن الصفحات حتى نختبرها آلياً (tests/*.test.mjs) ويضل الحساب ثابت لما نعدّل التصميم.
// ما في هون أي تغيير بالسلوك: هاي نفس المعادلات اللي كانت جوّا sales.html / payroll.html / index.html.

// ---------------------------------------------------------------
// المبيعات
// ---------------------------------------------------------------

// مجموع البيعة = كاش + بطاقة + توصيل
function olvSaleTotal(r) {
  return Number(r.cash_amount) + Number(r.card_amount) + Number(r.delivery_amount);
}

// طلب «على حساب موظف»: مبلغه صفر بالمبيعات، والذمة (بالتكلفة) مكتوبة بالملاحظات: «على حساب الموظف <اسم> — <مبلغ>»
const OLV_STAFF_RE = /على حساب الموظف\s+(.+?)\s+—\s+([\d.]+)/;
function olvStaffAcct(r) {
  if (olvSaleTotal(r) !== 0) return null;
  const m = OLV_STAFF_RE.exec(r.notes || "");
  return m ? { name: m[1], amount: Number(m[2]) } : null;
}

// وجبة موظف: بيعة صفرية بنوع «وجبة موظف»
function olvIsMeal(r) {
  return r.order_type === "وجبة موظف" && olvSaleTotal(r) === 0;
}

// ملخص مبيعات فترة: طلبات الموظفين (على الحساب + الوجبات) والملغية ما بتنعدّ بالعدد ولا بالمتوسط ولا بالمجموع
function olvSummarizeSales(rows) {
  const staffRows = rows.filter((r) => r.status !== "voided" && olvStaffAcct(r));
  const mealRows = rows.filter((r) => r.status !== "voided" && olvIsMeal(r));
  const done = rows.filter((r) => r.status !== "voided" && !olvStaffAcct(r) && !olvIsMeal(r));
  const voided = rows.filter((r) => r.status === "voided");
  const total = done.reduce((s, r) => s + olvSaleTotal(r), 0);
  return {
    staffRows, mealRows, done, voided,
    total,
    count: done.length,
    avg: done.length ? total / done.length : 0,
    voidAmt: voided.reduce((s, r) => s + olvSaleTotal(r), 0),
  };
}

// «صافي اليوم» = المبيعات − المصروفات المنحسبة (الذمم بس لما تنسدّد، شوف olvCombineExpensesPaid)
function olvDayNet(totalSales, totalExpenses) {
  return totalSales - totalExpenses;
}

// ---------------------------------------------------------------
// المصروفات المنحسبة فعلياً (قاعدة المالك 2026-11-16)
// ---------------------------------------------------------------

// يجمّع نتائج الاستعلامات (من olvExpensesPaid بـ auth-guard.js) بدون ما يلمس قاعدة البيانات:
//  cash        : مصروفات payment_type=cash غير مسدّدة بالفترة (بتاريخ المصروف)
//  settled     : مصروفات انسدّدت بالفترة (بتاريخ settled_at)
//  invoices    : فواتير الشراء غير النقدية المرتبطة بالمصروفات {expense_id, status, payment_type, paid_amount}
//  payments    : دفعات المورّدين اللاحقة {id, amount, transaction_date, description}
// القاعدة: الفاتورة الآجلة/الجزئية بتنحسب بس بقدر اللي اندفع (paid_amount) بتاريخ الفاتورة، والدفعات اللاحقة بتاريخ الدفعة.
function olvCombineExpensesPaid({ cash, settled, invoices, payments }) {
  const settledRows = (settled || []).map((r) => ({ ...r, expense_date: String(r.settled_at).slice(0, 10) }));
  const cashRows = (cash || []).map((r) => ({ ...r }));
  const paidAt = {};
  (invoices || []).forEach((x) => { paidAt[x.expense_id] = x.status === "voided" ? null : Number(x.paid_amount) || 0; });
  cashRows.forEach((r) => { if (r.id in paidAt && paidAt[r.id] !== null) r.amount = Math.min(Number(r.amount), paidAt[r.id]); });
  const extra = (payments || []).map((x) => ({
    id: "sp-" + x.id, amount: Number(x.amount), expense_date: x.transaction_date,
    description: x.description || "دفعة مورّد", expense_categories: { name: "مشتريات ومخزون" },
  }));
  return [...cashRows, ...settledRows, ...extra];
}

// ---------------------------------------------------------------
// الرواتب
// ---------------------------------------------------------------

// مكافأة يوم العطلة الأسبوعي المدفوع: 10 دنانير عن كل أسبوع خلص (جمعة). ما في خصم للغياب (قرار المالك 2026-11-07)
const OLV_WEEKLY_BONUS = 10;

// عدد أيام الجمعة بين تاريخين (شامل الطرفين، YYYY-MM-DD)
function olvCountFridays(from, to) {
  let n = 0;
  for (let d = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z"); d <= end; d = new Date(d.getTime() + 864e5)) {
    if (d.getUTCDay() === 5) n++;
  }
  return n;
}

// أسابيع المكافأة: من أول يوم دوام فعلي للموظف (أو بداية الفترة لو بعده) لآخر يوم مكتمل. بدون يوم دوام = صفر
function olvBonusWeeks(periodFrom, periodTo, firstWorkDay) {
  if (!firstWorkDay) return 0;
  const from = firstWorkDay > periodFrom ? firstWorkDay : periodFrom;
  return from <= periodTo ? olvCountFridays(from, periodTo) : 0;
}

// المكافأة تنحسب بس لو الموظف اشتغل ساعات بالفترة
function olvWeeklyBonus(hours, weeks, perWeek = OLV_WEEKLY_BONUS) {
  return hours > 0 ? perWeek * weeks : 0;
}

// مجموع الساعات اللي فوق الحد اليومي (اختياري لكل موظف): بتضل ظاهرة بس ما بتنحسب مصاري
function olvCapCut(dayHours, cap) {
  if (!cap) return 0;
  return (dayHours || []).reduce((s, h) => s + (Number(h) > cap ? Number(h) - cap : 0), 0);
}
function olvCappedHours(totalHours, dayHours, cap) {
  return Math.max(0, totalHours - olvCapCut(dayHours, cap));
}

// صف الراتب: المكتسب = ساعات×أجر + مكافأة + تسويات (إضافات/خصومات HR)، والصافي = المكتسب + الباقي من دفعة سابقة − السلف.
// hourlyWage = null (ما إله أجر) بيعني الساعات ما بتنحسب مصاري.
function olvPayrollRow({ hours, hourlyWage, weeks, adjTotal = 0, carry = 0, advancesTotal = 0 }) {
  const bonus = olvWeeklyBonus(hours, weeks);
  const earned = (hourlyWage != null ? hours * hourlyWage : 0) + bonus + adjTotal;
  return { bonus, earned, net: earned + carry - advancesTotal };
}

// الباقي (له/عليه) بعد دفعة: الإجمالي المسجّل − السلف − المدفوع، مقرّب لقرشين
function olvPayrollCarry(p) {
  return Math.round((Number(p.gross_amount) - Number(p.advances_deducted) - Number(p.net_amount)) * 100) / 100;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    olvSaleTotal, olvStaffAcct, olvIsMeal, olvSummarizeSales, olvDayNet, olvCombineExpensesPaid,
    OLV_WEEKLY_BONUS, olvCountFridays, olvBonusWeeks, olvWeeklyBonus, olvCapCut, olvCappedHours, olvPayrollRow, olvPayrollCarry,
  };
}
