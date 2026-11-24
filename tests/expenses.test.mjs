// مصروفات اليوم / صافي اليوم — قاعدة المالك (2026-11-16): الذمم ما بتنحسب مصروف إلا يوم الدفع
import test from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScripts, fakeDb } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");
const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0);

test("مصروف كاش عادي بينحسب كامل بتاريخه", () => {
  const rows = c.olvCombineExpensesPaid({ cash: [{ id: 1, amount: 12.5, expense_date: "2026-11-16" }], settled: [], invoices: [], payments: [] });
  assert.equal(sum(rows), 12.5);
});

test("فاتورة آجلة كاملة (ما اندفع شي): ما بتنحسب مصروف يوم الفاتورة", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [{ id: 7, amount: 200, expense_date: "2026-11-16" }], settled: [],
    invoices: [{ expense_id: 7, status: "open", payment_type: "credit", paid_amount: 0 }], payments: [],
  });
  assert.equal(sum(rows), 0);
});

test("فاتورة جزئية: بتنحسب بس اللي اندفع عند الفاتورة", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [{ id: 7, amount: 200, expense_date: "2026-11-16" }], settled: [],
    invoices: [{ expense_id: 7, status: "open", payment_type: "partial", paid_amount: 50 }], payments: [],
  });
  assert.equal(sum(rows), 50);
});

test("المدفوع ما بيزيد عن مبلغ المصروف", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [{ id: 7, amount: 40, expense_date: "2026-11-16" }], settled: [],
    invoices: [{ expense_id: 7, status: "open", payment_type: "partial", paid_amount: 90 }], payments: [],
  });
  assert.equal(sum(rows), 40);
});

test("فاتورة ملغية: بتضل بمبلغها (ما في تعديل) — السلوك الحالي", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [{ id: 7, amount: 60, expense_date: "2026-11-16" }], settled: [],
    invoices: [{ expense_id: 7, status: "voided", payment_type: "credit", paid_amount: 0 }], payments: [],
  });
  assert.equal(sum(rows), 60);
});

test("دفعة مورّد لاحقة بتنحسب بتاريخ الدفعة وبتصنيف «مشتريات ومخزون»", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [], settled: [], invoices: [],
    payments: [{ id: 3, amount: 150, transaction_date: "2026-11-20", description: null }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expense_date, "2026-11-20");
  assert.equal(rows[0].amount, 150);
  assert.equal(rows[0].expense_categories.name, "مشتريات ومخزون");
  assert.equal(rows[0].description, "دفعة مورّد");
});

test("مصروف انسدّد بتاريخ لاحق بينحسب بتاريخ التسديد مش تاريخ الفاتورة", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [], invoices: [], payments: [],
    settled: [{ id: 9, amount: 80, expense_date: "2026-11-10", settled_at: "2026-11-18T09:30:00Z" }],
  });
  assert.equal(rows[0].expense_date, "2026-11-18");
  assert.equal(sum(rows), 80);
});

test("سيناريو يوم كامل: كاش + فاتورة جزئية + ذمة + دفعة مورّد", () => {
  const rows = c.olvCombineExpensesPaid({
    cash: [
      { id: 1, amount: 10, expense_date: "2026-11-16" },   // كاش
      { id: 2, amount: 200, expense_date: "2026-11-16" },  // جزئية، اندفع 50
      { id: 3, amount: 300, expense_date: "2026-11-16" },  // آجلة كلها
    ],
    invoices: [
      { expense_id: 2, status: "open", payment_type: "partial", paid_amount: 50 },
      { expense_id: 3, status: "open", payment_type: "credit", paid_amount: 0 },
    ],
    settled: [],
    payments: [{ id: 1, amount: 100, transaction_date: "2026-11-16" }],
  });
  assert.equal(sum(rows), 10 + 50 + 0 + 100);
  assert.equal(c.olvDayNet(500, sum(rows)), 340); // صافي اليوم = مبيعات − مصروفات منحسبة
});

test("صافي اليوم بيطلع سالب لو المصروفات أكبر", () => {
  assert.equal(c.olvDayNet(100, 130), -30);
});

// ---- olvExpensesPaid الكاملة (auth-guard.js) مع قاعدة بيانات وهمية ----
test("olvExpensesPaid: بتجمّع الاستعلامات وبتطبّق قاعدة الذمم", async () => {
  const ctx = loadBrowserScripts("finance-calc.js", "auth-guard.js");
  const db = fakeDb({
    expenses: (q) => q.filters.some((f) => f[0] === "not")
      ? { data: [{ id: 5, amount: 75, expense_date: "2026-11-01", settled_at: "2026-11-16T08:00:00Z" }], error: null }
      : { data: [{ id: 1, amount: 20, expense_date: "2026-11-16" }, { id: 2, amount: 100, expense_date: "2026-11-16" }], error: null },
    purchase_invoices: { data: [{ expense_id: 2, status: "open", payment_type: "credit", paid_amount: 0 }], error: null },
    supplier_transactions: { data: [{ id: 8, amount: 30, transaction_date: "2026-11-16", description: "دفعة" }], error: null },
  });
  const { data, error } = await ctx.olvExpensesPaid(db, "amount", "2026-11-16", "2026-11-16");
  assert.equal(error, null);
  assert.equal(sum(data), 20 + 0 + 75 + 30);
  assert.ok(data.every((r) => r.expense_date === "2026-11-16"));
});

test("olvExpensesPaid: لو فشل استعلام المصروفات بترجّع الخطأ ولا بتخمّن", async () => {
  const ctx = loadBrowserScripts("finance-calc.js", "auth-guard.js");
  const db = fakeDb({ expenses: { data: null, error: { message: "boom" } } });
  const r = await ctx.olvExpensesPaid(db, "amount", "2026-11-16", "2026-11-16");
  assert.equal(r.data, null);
  assert.equal(r.error.message, "boom");
});

// ---- السلوك الحالي المعترض عليه (PR #353/#354) — موثّق وما انغيّر بدون موافقة المالك ----
test("[موثّق] الجزء المدفوع عند الفاتورة بينحسب بتاريخ الفاتورة (مش بتاريخ الدفع)", () => {
  // فاتورة 11/16 بـ 200 دفع منها 50 وقتها: الـ 50 بتنحسب بـ 11/16. لو المالك بدّها «بتاريخ الدفع الفعلي» بتكون نفس اليوم
  // بالحالة العادية؛ الفرق بيظهر بس لو الدفعة المرتبطة بالفاتورة صارت بيوم تاني (ما في تاريخ دفع مخزّن على الفاتورة نفسها).
  const rows = c.olvCombineExpensesPaid({
    cash: [{ id: 2, amount: 200, expense_date: "2026-11-16" }], settled: [],
    invoices: [{ expense_id: 2, status: "open", payment_type: "partial", paid_amount: 50 }], payments: [],
  });
  assert.equal(rows[0].expense_date, "2026-11-16");
  assert.equal(rows[0].amount, 50);
});
