// الخادم بيقطع كل رد عند 1000 صف: تقارير الشهر (آلاف المبيعات) كانت تطلع بأرقام ناقصة. olvFetchAll لازم يجمع كل الصفحات.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScripts } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");

// استعلام وهمي بيتصرف مثل الخادم: بيرجّع max 1000 صف حتى لو طلبنا أكتر
function fakeQuery(total, cap = 1000) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return () => ({ range: async (a, b) => ({ data: all.slice(a, Math.min(b + 1, a + cap)), error: null }) });
}

test("6883 صف (مبيعات شهر): بترجع كلها مو 1000", async () => {
  const r = await c.olvFetchAll(fakeQuery(6883));
  assert.equal(r.error, null);
  assert.equal(r.data.length, 6883);
  assert.equal(new Set(r.data.map((x) => x.id)).size, 6883);
});

test("بالضبط 1000 و 2000 وصفر وصف", async () => {
  assert.equal((await c.olvFetchAll(fakeQuery(1000))).data.length, 1000);
  assert.equal((await c.olvFetchAll(fakeQuery(2000))).data.length, 2000);
  assert.equal((await c.olvFetchAll(fakeQuery(0))).data.length, 0);
});

test("خطأ بصفحة بيرجع الخطأ (ما بنعرض رقم ناقص)", async () => {
  let n = 0;
  const r = await c.olvFetchAll(() => ({ range: async () => (++n === 2 ? { data: null, error: new Error("x") } : { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }) }));
  assert.equal(r.data, null);
  assert.ok(r.error);
});
