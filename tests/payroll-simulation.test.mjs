// محاكاة شهر كامل من دفعات الرواتب (جزئية، بسلف، مع بصمات بتتغيّر بعد الدفع).
// بتنفّذ نفس خطوات payroll.html (confirmPay) بالدوال المختبرة بـ finance-calc.js وبتتأكد من قاعدة وحدة:
// المتبقي (carry) دايماً = المستحق الحقيقي من البصمات الحالية − اللي انقبض − السلف، بدون فرق قرش وبدون حساب مرتين.
import test from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScripts } from "./helpers.mjs";

const c = loadBrowserScripts("finance-calc.js");
const r2 = c.olvRound2;
const WAGE = 0.75;

const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// مولّد أرقام عشوائية ثابت (نفس النتيجة كل مرة)
function rng(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }

// موظف يداوم كل يوم (ما عدا يوم إجازة) من 14/11 لـ 14/12
function makeDays(rand) {
  const days = [];
  for (let i = 0; i < 31; i++) {
    const date = addDays("2026-11-14", i);
    if (rand() < 0.15) continue; // يوم إجازة بدون بصمة
    days.push({ date, hours: r2(5 + rand() * 9), status: "ok" });
  }
  return days;
}

// نفس حساب confirmPay: ساعات الفترة الجديدة + تصحيح (لو انطبّق) + مكافأة − سلف + الباقي، والدفعة بتسجّل الساعات مع التصحيح المكتشف
function pay(state, to, { payFraction = 1, advances = 0, applyRecon = true } = {}) {
  const from = state.pays.length ? addDays(state.pays[state.pays.length - 1].period_end, 1) : state.days[0].date;
  const hours = r2(state.days.filter((d) => d.date >= from && d.date <= to).reduce((t, d) => t + d.hours, 0));
  const recon = c.olvReconcileHours({ pays: state.pays, days: state.days });
  const firstWork = state.days[0].date;
  const weeks = c.olvBonusWeeks(from, to, firstWork);
  const row = c.olvPayrollRow({ hours, hourlyWage: WAGE, weeks, carry: state.carry, advancesTotal: advances, reconHours: applyRecon ? recon.hours : 0 });
  const net = r2(row.net * payFraction);
  const p = {
    paid_at: addDays(to, 1) + "T10:00:00Z", period_start: from, period_end: to,
    hours_worked: r2(hours + recon.hours), gross_amount: r2(row.earned + state.carry), advances_deducted: advances, net_amount: net,
  };
  state.pays.push(p);
  state.carry = c.olvPayrollCarry(p);
  state.advances += advances;
  state.net += net;
  return { row, recon };
}

// المستحق الحقيقي من البصمات الحالية بالفترة المدفوعة (ساعات + مكافأة 10 عن كل جمعة)، بدون أي تصحيح
function entitled(state, applied = true) {
  const to = state.pays[state.pays.length - 1].period_end;
  const hours = state.days.filter((d) => d.date <= to).reduce((t, d) => t + d.hours, 0);
  return r2(hours * WAGE + c.olvBonusWeeks(state.days[0].date, to, state.days[0].date) * 10);
}

const fresh = (seed) => ({ days: makeDays(rng(seed)), pays: [], carry: 0, advances: 0, net: 0 });

test("محاكاة: دفعات جزئية متتالية، الباقي دايماً = المستحق − المدفوع − السلف", () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    const st = fresh(seed);
    const rand = rng(seed + 1000);
    for (const to of ["2026-11-20", "2026-11-23", "2026-11-30", "2026-12-04", "2026-12-10", "2026-12-14"]) {
      pay(st, to, { payFraction: 0.5 + rand() * 0.6, advances: rand() < 0.4 ? r2(rand() * 15) : 0 });
      const expect = r2(entitled(st) - st.net - st.advances);
      assert.ok(Math.abs(st.carry - expect) <= 0.03, `seed ${seed} حتى ${to}: carry ${st.carry} المتوقع ${expect}`);
    }
  }
});

test("محاكاة: بصمة بتنضاف بعد الدفع + طُبّق التصحيح = المتبقي صح وبيرجع صفر بعد الدفع الكامل", () => {
  const st = fresh(5);
  pay(st, "2026-11-23");
  st.days.push({ date: "2026-11-21", hours: 3, status: "ok" }); st.days.sort((a, b) => a.date.localeCompare(b.date));
  // بصمة يوم 21/11 اللي كانت ناقصة (يوم كان إجازة) انضافت بعد الدفع
  const second = pay(st, "2026-11-30");
  assert.ok(second.recon.hours > 0);
  assert.ok(Math.abs(st.carry - r2(entitled(st) - st.net - st.advances)) <= 0.03);
  // دفعة ثالثة بدون أي حدث: ما في تصحيح جديد (ما بيتحسب مرتين)
  assert.equal(pay(st, "2026-12-05").recon.hours, 0);
  assert.ok(Math.abs(st.carry) <= 0.03, `الباقي بعد دفع كامل ${st.carry}`);
});

test("محاكاة: دوام انلغى بعد الدفع (مدفوع زيادة) + تطبيق التصحيح بيخصمه مرة وحدة", () => {
  const st = fresh(11);
  pay(st, "2026-11-27");
  const removed = st.days.find((d) => d.date === "2026-11-18" || d.date === "2026-11-19" || d.date === "2026-11-20");
  const hrs = removed.hours;
  st.days = st.days.filter((d) => d !== removed);
  const second = pay(st, "2026-12-03");
  assert.equal(second.recon.hours, r2(-hrs));
  assert.ok(Math.abs(st.carry - r2(entitled(st) - st.net - st.advances)) <= 0.03);
  assert.equal(pay(st, "2026-12-08").recon.hours, 0);
});

test("محاكاة: تجاهل التصحيح = الفرق ما بينحسب مصاري ولا بيرجع ينبّه", () => {
  const st = fresh(13);
  pay(st, "2026-11-27");
  const gone = st.days.find((d) => d.date === "2026-11-20") || st.days.find((d) => d.date > "2026-11-17" && d.date < "2026-11-27");
  st.days = st.days.filter((d) => d !== gone);
  const before = st.carry;
  const second = pay(st, "2026-12-03", { applyRecon: false });
  assert.ok(second.recon.hours < 0);
  // المبلغ ما اتأثر بالتصحيح: carry بيعتمد بس على ساعات الفترة الجديدة
  const periodHours = r2(st.days.filter((d) => d.date > "2026-11-27" && d.date <= "2026-12-03").reduce((t, d) => t + d.hours, 0));
  const expectGross = r2(periodHours * WAGE + 10 * c.olvBonusWeeks("2026-11-28", "2026-12-03", "2026-11-14") + before);
  assert.equal(st.pays[1].gross_amount, expectGross);
  assert.equal(pay(st, "2026-12-08").recon.hours, 0); // ما رجع ينبّه
});

test("محاكاة: أجر بكسور (0.75 × 61.18) ودفعات كثيرة صغيرة ما بتراكم فرق قروش", () => {
  const st = fresh(77);
  let to = "2026-11-15";
  for (let i = 0; i < 25; i++) { pay(st, to, { payFraction: 0.7 }); to = addDays(to, 1); }
  assert.ok(Math.abs(st.carry - r2(entitled(st) - st.net - st.advances)) <= 0.05);
  // كل رقم مخزّن بقرشين بالضبط
  st.pays.forEach((p) => { assert.equal(p.gross_amount, r2(p.gross_amount)); assert.equal(p.net_amount, r2(p.net_amount)); });
});
