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
