// دوال حساب نقية (بدون شاشة ولا قاعدة بيانات) للمبيعات والمصروفات والرواتب.
// مفصولة عن الصفحات حتى نختبرها آلياً (tests/*.test.mjs) ويضل الحساب ثابت لما نعدّل التصميم.
// ما في هون أي تغيير بالسلوك: هاي نفس المعادلات اللي كانت جوّا sales.html / payroll.html / index.html.

// ---------------------------------------------------------------
// جلب كل الصفوف (الخادم بيقطع الرد عند 1000 صف مهما كان limit، فالتقارير الطويلة كانت تنقص أرقامها)
// ---------------------------------------------------------------

// build: دالة بترجّع استعلام جديد كل مرة (مع ترتيب ثابت .order("id") عشان الصفحات ما تتكرر ولا تضيع صفوف).
// بترجّع {data, error} زي supabase، وبتجمع الصفحات لحد ما تخلص.
async function olvFetchAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < pageSize) return { data: out, error: null };
  }
}

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

// تقريب لقرشين (بنقرّب كل رقم مالي مرة وحدة حتى ما يتراكم فرق القروش بين الصفحات والدفعات)
function olvRound2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

// تصحيح الساعات بعد الدفع: الدفعات من هالتاريخ وطالع بتتراجع تلقائياً مع البصمات الحالية.
// قبله انراجعت يدوي وفروقها متعوّضة ببنود «تسوية» (ما بنرجع نعدّها حتى ما تنحسب مرتين).
const OLV_RECON_FROM = "2026-11-13";

// بصمة انضافت/انعدلت/انحذفت بعد ما انحسبت الدفعة (مثال: خروج منسي انكتب بعد الدفع) بتغيّر ساعات الفترة المدفوعة.
// الفرق = ساعات البصمات الحالية بين أول دفعة بعد التاريخ وآخر يوم مدفوع − مجموع الساعات اللي انسجلت بالدفعات.
// بيتحسب تراكمياً: لما الفرق ينندفع بدفعة (hours_worked بتشمله) بيرجع صفر لحاله، فما في تسوية يدوية ولا حساب مرتين.
// pays: دفعات الموظف (paid_at, period_start, period_end, hours_worked) | days: [{ date, hours, status }] من attendance_daily
function olvReconcileHours({ pays, days, cap = null, fromPaid = OLV_RECON_FROM }) {
  const list = (pays || []).filter((p) => String(p.paid_at).slice(0, 10) >= fromPaid);
  if (!list.length) return { hours: 0, from: null, to: null };
  const day = (v) => String(v).slice(0, 10);
  const from = list.reduce((m, p) => (day(p.period_start) < m ? day(p.period_start) : m), day(list[0].period_start));
  const to = list.reduce((m, p) => (day(p.period_end) > m ? day(p.period_end) : m), day(list[0].period_end));
  const paid = list.reduce((t, p) => t + (Number(p.hours_worked) || 0), 0);
  const now = (days || []).reduce((t, d) => {
    const wd = day(d.date), h = Number(d.hours) || 0;
    return d.status === "ok" && wd >= from && wd <= to ? t + (cap && h > cap ? cap : h) : t;
  }, 0);
  const diff = olvRound2(now - paid);
  return { hours: Math.abs(diff) < 0.02 ? 0 : diff, from, to };
}

// صف الراتب: المكتسب = ساعات×أجر + تصحيح ساعات سابقة + مكافأة + تسويات (إضافات/خصومات HR)، والصافي = المكتسب + الباقي من دفعة سابقة − السلف.
// hourlyWage = null (ما إله أجر) بيعني الساعات ما بتنحسب مصاري. كل الأرقام مقرّبة لقرشين.
function olvPayrollRow({ hours, hourlyWage, weeks, adjTotal = 0, carry = 0, advancesTotal = 0, reconHours = 0 }) {
  const bonus = olvWeeklyBonus(hours, weeks);
  const w = hourlyWage != null ? hourlyWage : 0;
  const reconAmt = olvRound2(reconHours * w);
  const earned = olvRound2(olvRound2(hours * w) + reconAmt + bonus + adjTotal);
  return { bonus, reconAmt, earned, net: olvRound2(earned + carry - advancesTotal) };
}

// الباقي (له/عليه) بعد دفعة: الإجمالي المسجّل − السلف − المدفوع، مقرّب لقرشين
function olvPayrollCarry(p) {
  return Math.round((Number(p.gross_amount) - Number(p.advances_deducted) - Number(p.net_amount)) * 100) / 100;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    olvSaleTotal, olvStaffAcct, olvIsMeal, olvSummarizeSales, olvDayNet, olvCombineExpensesPaid,
    OLV_WEEKLY_BONUS, olvCountFridays, olvBonusWeeks, olvWeeklyBonus, olvCapCut, olvCappedHours, olvPayrollRow, olvPayrollCarry, olvRound2, olvReconcileHours, OLV_RECON_FROM,
  };
}
