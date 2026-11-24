// المبيعات: عدّ الطلبات والمتوسط، واستبعاد مبيعات «على حساب الموظفين» ووجبات الموظفين (PR #315/#352)
import test from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScripts } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");
const sale = (cash, card = 0, delivery = 0, extra = {}) => ({ cash_amount: cash, card_amount: card, delivery_amount: delivery, status: "completed", notes: "", ...extra });
const staff = (name, cost) => sale(0, 0, 0, { notes: `على حساب الموظف ${name} — ${cost}` });
const meal = (name) => sale(0, 0, 0, { order_type: "وجبة موظف", customer_name: name });

test("مجموع البيعة = كاش + بطاقة + توصيل (حتى لو الأرقام نصوص)", () => {
  assert.equal(c.olvSaleTotal(sale("5.5", "2", "1.5")), 9);
});

test("طلب على حساب موظف: بيتعرّف باسمه وبمبلغ التكلفة", () => {
  assert.deepEqual({ ...c.olvStaffAcct(staff("أحمد شاهير", "4.25")) }, { name: "أحمد شاهير", amount: 4.25 });
});

test("بيعة عادية ملاحظتها فيها «على حساب الموظف» بس مبلغها مش صفر = مش طلب موظف", () => {
  assert.equal(c.olvStaffAcct(sale(3, 0, 0, { notes: "على حساب الموظف زيد — 3" })), null);
});

test("ملاحظة بدون تنسيق «اسم — مبلغ» = مش طلب موظف", () => {
  assert.equal(c.olvStaffAcct(sale(0, 0, 0, { notes: "على حساب الموظف زيد" })), null);
});

test("وجبة موظف لازم نوعها «وجبة موظف» ومبلغها صفر", () => {
  assert.equal(c.olvIsMeal(meal("لؤي")), true);
  assert.equal(c.olvIsMeal(sale(2, 0, 0, { order_type: "وجبة موظف" })), false);
  assert.equal(c.olvIsMeal(sale(0)), false);
});

test("الملخص: طلبات الموظفين والوجبات والملغية ما بتدخل بالعدد ولا المتوسط ولا المجموع", () => {
  const rows = [
    sale(10), sale(5, 5), sale(0, 0, 20),            // 3 طلبات حقيقية = 10 + 10 + 20 = 40
    staff("أحمد", 3), staff("أحمد", 2), meal("لؤي"),  // مستبعدة
    sale(100, 0, 0, { status: "voided" }),            // ملغية
  ];
  const s = c.olvSummarizeSales(rows);
  assert.equal(s.count, 3);
  assert.equal(s.total, 40);
  assert.ok(Math.abs(s.avg - 40 / 3) < 1e-9);
  assert.equal(s.staffRows.length, 2);
  assert.equal(s.mealRows.length, 1);
  assert.equal(s.voided.length, 1);
  assert.equal(s.voidAmt, 100);
});

test("الملخص: فترة بدون مبيعات = متوسط صفر (بدون قسمة على صفر)", () => {
  const s = c.olvSummarizeSales([staff("زيد", 1)]);
  assert.equal(s.count, 0);
  assert.equal(s.avg, 0);
});

test("طلب موظف ملغي ما بينعدّ بقسم الموظفين", () => {
  const s = c.olvSummarizeSales([{ ...staff("زيد", 1), status: "voided" }]);
  assert.equal(s.staffRows.length, 0);
  assert.equal(s.voided.length, 1);
});
