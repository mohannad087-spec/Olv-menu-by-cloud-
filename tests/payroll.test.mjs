// الرواتب: المكافأة الأسبوعية (10 دنانير عن كل جمعة)، التسويات/الخصومات، السلف، والباقي من دفعة سابقة
import test from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScripts } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");

test("عدد أيام الجمعة بين تاريخين (شامل الطرفين)", () => {
  // 2026-11-20 جمعة
  assert.equal(c.olvCountFridays("2026-11-20", "2026-11-20"), 1);
  assert.equal(c.olvCountFridays("2026-11-21", "2026-11-26"), 0);
  assert.equal(c.olvCountFridays("2026-11-01", "2026-11-30"), 4); // 6, 13, 20, 27
  assert.equal(c.olvCountFridays("2026-11-07", "2026-11-13"), 1);
});

test("المكافأة بتبدأ من أول يوم دوام فعلي مش من بداية الفترة", () => {
  // بدأ الأحد 15/11: جمع 20 و27 = أسبوعين (الجمعة 6 و13 ما انحسبوا)
  assert.equal(c.olvBonusWeeks("2026-11-01", "2026-11-30", "2026-11-15"), 2);
  // بدأ قبل الفترة: بتنحسب من بداية الفترة
  assert.equal(c.olvBonusWeeks("2026-11-10", "2026-11-30", "2026-10-01"), 3); // 13, 20, 27
});

test("موظف بدون أي يوم دوام = صفر أسابيع", () => {
  assert.equal(c.olvBonusWeeks("2026-11-01", "2026-11-30", null), 0);
});

test("أول يوم دوام بعد نهاية الفترة = صفر أسابيع", () => {
  assert.equal(c.olvBonusWeeks("2026-11-01", "2026-11-10", "2026-11-12"), 0);
});

test("المكافأة بس لو اشتغل ساعات: 10 × عدد الأسابيع", () => {
  assert.equal(c.olvWeeklyBonus(30, 3), 30);
  assert.equal(c.olvWeeklyBonus(0, 3), 0);
});

test("صف الراتب: ساعات × أجر + مكافأة", () => {
  const r = c.olvPayrollRow({ hours: 40, hourlyWage: 1, weeks: 1 });
  assert.equal(r.bonus, 10);
  assert.equal(r.earned, 50);
  assert.equal(r.net, 50);
});

test("أجر الساعة غير الافتراضي (1.40) بيتضرب بالساعات", () => {
  const r = c.olvPayrollRow({ hours: 50, hourlyWage: 1.4, weeks: 0 });
  assert.ok(Math.abs(r.earned - 70) < 1e-9);
});

test("خصومات HR (تسوية سالبة) والسلف بينقصوا الصافي", () => {
  const r = c.olvPayrollRow({ hours: 60, hourlyWage: 1, weeks: 1, adjTotal: -15, advancesTotal: 20 });
  assert.equal(r.earned, 60 + 10 - 15);
  assert.equal(r.net, 55 - 20);
});

test("الباقي له من دفعة سابقة بينضاف، والمدفوع زيادة (سالب) بينخصم", () => {
  assert.equal(c.olvPayrollRow({ hours: 10, hourlyWage: 1, weeks: 0, carry: 5 }).net, 15);
  assert.equal(c.olvPayrollRow({ hours: 10, hourlyWage: 1, weeks: 0, carry: -4 }).net, 6);
});

test("بدون أجر ساعة (null): الساعات ما بتنحسب بس المكافأة والتسويات بتنحسب", () => {
  const r = c.olvPayrollRow({ hours: 40, hourlyWage: null, weeks: 1, adjTotal: 3 });
  assert.equal(r.earned, 13);
});

test("لا ساعات: لا مكافأة حتى لو في أسابيع", () => {
  const r = c.olvPayrollRow({ hours: 0, hourlyWage: 1, weeks: 2 });
  assert.equal(r.bonus, 0);
  assert.equal(r.net, 0);
});

test("[موثّق] يوم الإجازة (بدون بصمة) ما بينخصم منه 10: قرار المالك 2026-11-07", () => {
  // الأيام اللي ما داوم فيها ما إلها ساعات = ما إلها مصاري، والمكافأة ثابتة 10 × الجمع، بدون خصم إضافي
  const worked5Days = c.olvPayrollRow({ hours: 40, hourlyWage: 1, weeks: 1 });
  const worked6Days = c.olvPayrollRow({ hours: 48, hourlyWage: 1, weeks: 1 });
  assert.equal(worked6Days.net - worked5Days.net, 8); // الفرق ساعات اليوم الزيادة بس
});

test("الحد اليومي للساعات: الساعات فوق الحد بتضل ظاهرة بس ما بتنحسب", () => {
  assert.equal(c.olvCapCut([8, 12, 10], 10), 2);
  assert.equal(c.olvCappedHours(30, [8, 12, 10], 10), 28);
  assert.equal(c.olvCappedHours(30, [8, 12, 10], null), 30);
  assert.equal(c.olvCappedHours(1, [20], 10), 0); // ما بتنزل تحت الصفر
});

test("الباقي بعد الدفعة = الإجمالي − السلف − المدفوع (مقرّب لقرشين)", () => {
  assert.equal(c.olvPayrollCarry({ gross_amount: 100, advances_deducted: 20, net_amount: 70 }), 10);
  assert.equal(c.olvPayrollCarry({ gross_amount: "50.10", advances_deducted: "0", net_amount: "50.12" }), -0.02);
  assert.equal(c.olvPayrollCarry({ gross_amount: 40, advances_deducted: 0, net_amount: 55 }), -15);
});

// ---- تصحيح الساعات بعد الدفع (سبب «ناقص/زايد» كل يوم) ----
const pay = (paid_at, s, e, h) => ({ paid_at, period_start: s, period_end: e, hours_worked: h });
const day = (date, hours, status = "ok") => ({ date, hours, status });

test("بصمة انضافت بعد الدفع: الساعات الناقصة بترجع تلقائياً للدفعة الجاية", () => {
  const r = c.olvReconcileHours({ pays: [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-15", 10)], days: [day("2026-11-14", 5), day("2026-11-15", 7.5)] });
  assert.equal(r.hours, 2.5);
  assert.equal(r.from, "2026-11-14");
  assert.equal(r.to, "2026-11-15");
});

test("بصمة انحذفت بعد الدفع (مدفوع زيادة): الفرق سالب وبينخصم", () => {
  const r = c.olvReconcileHours({ pays: [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-15", 20)], days: [day("2026-11-14", 8.67), day("2026-11-15", 0, "ignored")] });
  assert.equal(r.hours, -11.33);
});

test("بعد ما الفرق ينندفع (hours_worked بتشمله) بيرجع صفر وما بيتحسب مرتين", () => {
  const days = [day("2026-11-14", 5), day("2026-11-15", 7.5), day("2026-11-16", 4)];
  const first = [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-15", 10)];
  const d1 = c.olvReconcileHours({ pays: first, days }).hours; // 2.5
  // الدفعة التالية بتسجّل ساعات الفترة الجديدة (4) + التصحيح (2.5)
  const second = [...first, pay("2026-11-21T10:00:00Z", "2026-11-16", "2026-11-16", 4 + d1)];
  assert.equal(d1, 2.5);
  assert.equal(c.olvReconcileHours({ pays: second, days }).hours, 0);
});

test("دفعات قبل 2026-11-13 ما بتنعدّ (انراجعت يدوي بتسويات) وفروق القروش تحت 0.02 بتتجاهل", () => {
  assert.equal(c.olvReconcileHours({ pays: [pay("2026-11-05T10:00:00Z", "2026-11-01", "2026-11-04", 1)], days: [day("2026-11-02", 9)] }).hours, 0);
  assert.equal(c.olvReconcileHours({ pays: [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-14", 5)], days: [day("2026-11-14", 5.01)] }).hours, 0);
});

test("الحد اليومي بيطبّق على التصحيح، والأيام خارج الفترة المدفوعة ما بتتحسب", () => {
  const r = c.olvReconcileHours({ pays: [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-14", 8)], days: [day("2026-11-14", 12), day("2026-11-17", 9)], cap: 10 });
  assert.equal(r.hours, 2);
});

test("صف الراتب: تصحيح الساعات بينضاف للمستحق، والأرقام مقرّبة لقرشين", () => {
  const r = c.olvPayrollRow({ hours: 61.18, hourlyWage: 0.75, weeks: 1, reconHours: -11.33 });
  assert.equal(r.reconAmt, -8.5);
  assert.equal(r.earned, c.olvRound2(45.89 - 8.5 + 10)); // 45.885 بتتقرّب 45.89
  assert.equal(r.net, r.earned);
});

test("التقريب: مجموع بدون قروش عائمة (0.1+0.2)", () => {
  const r = c.olvPayrollRow({ hours: 0.1, hourlyWage: 1, weeks: 0, adjTotal: 0.2 });
  assert.equal(r.earned, 0.3);
});

test("تجاهل التصحيح: الساعات بتنسجل بالدفعة (hours_worked) بدون مصاري، فما بينبّه مرة ثانية", () => {
  const days = [day("2026-11-14", 5), day("2026-11-15", 7.5)];
  const first = [pay("2026-11-20T10:00:00Z", "2026-11-14", "2026-11-15", 10)];
  const d = c.olvReconcileHours({ pays: first, days }).hours; // 2.5 مكتشف
  const row = c.olvPayrollRow({ hours: 0, hourlyWage: 1, weeks: 0, reconHours: 0 }); // ما طُبّق: ما إله مصاري
  assert.equal(row.earned, 0);
  const afterIgnore = [...first, pay("2026-11-21T10:00:00Z", "2026-11-15", "2026-11-15", 0 + d)];
  assert.equal(c.olvReconcileHours({ pays: afterIgnore, days }).hours, 0);
});
