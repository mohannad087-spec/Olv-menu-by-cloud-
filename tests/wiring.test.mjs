// حارس: كل صفحة بتحمّل auth-guard.js لازم تحمّل finance-calc.js قبله (olvExpensesPaid بتعتمد عليه)،
// وصفحات المبيعات/الرواتب/الرئيسية ما ترجع تكرر المعادلات بدل ما تستعمل الدوال المختبرة.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";

const dir = path.join(ROOT, "accounting");
const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));

test("finance-calc.js محمّل قبل auth-guard.js بكل صفحة", () => {
  for (const f of pages) {
    const html = fs.readFileSync(path.join(dir, f), "utf8");
    const g = html.indexOf('src="assets/auth-guard.js"');
    if (g < 0) continue;
    const fc = html.indexOf('src="assets/finance-calc.js"');
    assert.ok(fc >= 0 && fc < g, `${f}: لازم finance-calc.js قبل auth-guard.js`);
  }
});

const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
test("sales.html بتستعمل الدوال المختبرة", () => {
  const s = read("sales.html");
  assert.match(s, /olvSummarizeSales\(rows\)/);
  assert.match(s, /olvStaffAcct\(r\)/);
});
test("payroll.html بتستعمل الدوال المختبرة", () => {
  const s = read("payroll.html");
  assert.match(s, /olvPayrollRow\(/);
  assert.match(s, /olvBonusWeeks\(/);
});
test("index.html بتستعمل olvDayNet لصافي اليوم", () => {
  assert.match(read("index.html"), /olvDayNet\(/);
});
