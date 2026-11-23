// الموارد البشرية: منطق مشترك بين hr.html (نظرة عامة) وhr-profile.html (ملف الموظف) وتنبيه الرئيسية.
//   window.OLV_HR: الثوابت، تحميل السجلات، تصعيد الإنذارات، اقتراحات الحضور، نافذة التسجيل/التعديل، الإلغاء، طباعة نموذج الإنذار.
// الكتابة كلها عبر دوال SQL (hr_create_record / hr_update_record / hr_cancel_record) بصلاحية المالك والمدير بس
// (schema-hr.sql). الخصم المالي والمكافأة بيتحولوا تلقائياً لبند بجدول payroll_adjustments وسببه ظاهر بكشف الراتب.
(function () {
  const db = () => window.supabaseClient;
  const esc = (v) => olvEsc(v);

  const KINDS = {
    warning_verbal: { label: "إنذار شفهي", cls: "verbal", level: 1 },
    warning_written: { label: "إنذار خطي", cls: "written", level: 2 },
    warning_final: { label: "إنذار نهائي", cls: "final", level: 3 },
    deduction: { label: "خصم مالي", cls: "deduction" },
    bonus: { label: "مكافأة", cls: "bonus" },
  };
  const REASONS = {
    late: "تأخر عن الدوام",
    absence: "غياب بدون عذر",
    misconduct: "سوء سلوك",
    performance: "ضعف بالأداء",
    hygiene: "مخالفة النظافة أو الزي",
    customer: "مشكلة مع زبون",
    other: "سبب آخر",
  };
  const BONUS_REASONS = { bonus_month: "موظف الشهر", bonus_commit: "التزام كامل", other: "سبب آخر" };
  const reasonLabel = (code) => REASONS[code] || BONUS_REASONS[code] || "سبب آخر";
  const isWarning = (k) => String(k).startsWith("warning_");
  const kindTag = (k, cancelled) =>
    `<span class="hr-tag ${KINDS[k] ? KINDS[k].cls : ""}${cancelled ? " cancelled" : ""}">${KINDS[k] ? KINDS[k].label : esc(k)}</span>`;

  const todayIso = () => olvToday();
  const addDays = (iso, d) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const money = (n) => olvFormatMoney(n);
  const fmtDate = (iso) => { try { return new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString("ar-JO", { day: "numeric", month: "short", year: "numeric" }); } catch (_) { return iso; } };

  // الإنذارات الفعّالة آخر 12 شهر (بتحدد المستوى التالي)
  function activeWarnings(records, profileId) {
    const from = addDays(todayIso(), -365);
    return records.filter((r) => r.status === "active" && isWarning(r.kind) && (!profileId || r.profile_id === profileId) && r.record_date > from);
  }
  function nextWarningKind(records, profileId) {
    const n = activeWarnings(records, profileId).length;
    return n === 0 ? "warning_verbal" : n === 1 ? "warning_written" : "warning_final";
  }

  async function loadRecords(profileId) {
    let q = db().from("hr_records").select("*").order("record_date", { ascending: false }).order("created_at", { ascending: false });
    if (profileId) q = q.eq("profile_id", profileId);
    const { data, error } = await q.limit(2000);
    if (error) throw error;
    return data || [];
  }

  // اقتراحات تلقائية: تأخر 3 أيام بالشهر، غياب بدون عذر، وتصعيد بعد 3 إنذارات
  async function loadSuggestions(employees, records) {
    const out = [];
    const nameOf = (id) => (employees.find((e) => e.id === id) || {}).full_name || "";
    const today = todayIso();
    const { data: dis } = await db().from("hr_dismissed").select("profile_id, suggest_key");
    const dismissed = new Set((dis || []).map((d) => d.profile_id + "|" + d.suggest_key));
    const used = new Set(records.filter((r) => r.status === "active" && r.suggest_key).map((r) => r.profile_id + "|" + r.suggest_key));
    const open = (pid, key) => !dismissed.has(pid + "|" + key) && !used.has(pid + "|" + key);

    try {
      const from = addDays(today, -59);
      const { data: att, error } = await db().rpc("attendance_report", { p_from: from, p_to: today });
      if (error) throw error;
      const lateBy = new Map();
      (att || []).forEach((r) => {
        if (!r.profile_id) return;
        if (["late", "late_early"].includes(r.status) && Number(r.late_min) > 0) {
          const k = r.work_date.slice(0, 7);
          const key = r.profile_id + "|" + k;
          const a = lateBy.get(key) || { pid: r.profile_id, month: k, n: 0, min: 0 };
          a.n++; a.min += Number(r.late_min);
          lateBy.set(key, a);
        }
        if (r.status === "absent" && r.work_date < today && r.work_date >= addDays(today, -14)) {
          const key = "absent:" + r.work_date;
          if (open(r.profile_id, key)) out.push({
            type: "absent", pid: r.profile_id, key, reason: "absence", date: r.work_date,
            title: `${nameOf(r.profile_id)}: غياب بدون بصمة بتاريخ ${fmtDate(r.work_date)}`,
            hint: "كان مجدول دوام وما في أي بصمة. اعتمد إنذار إذا الغياب بدون عذر، أو تجاهل إذا في عذر.",
            text: `غياب بدون عذر بتاريخ ${r.work_date}`,
          });
        }
      });
      lateBy.forEach((a) => {
        const key = "late:" + a.month;
        if (a.n >= 3 && open(a.pid, key)) out.push({
          type: "late", pid: a.pid, key, reason: "late", date: today,
          title: `${nameOf(a.pid)}: تأخر ${a.n} أيام بشهر ${a.month} (مجموع ${Math.round(a.min)} دقيقة)`,
          hint: "اقتراح إنذار بسبب التكرار. بتعتمده بضغطة وحدة.",
          text: `تأخر عن الدوام ${a.n} أيام خلال ${a.month} (مجموع ${Math.round(a.min)} دقيقة) حسب بصمة الحضور`,
        });
      });
    } catch (err) { console.warn("تعذّر حساب اقتراحات الحضور", err); }

    // تصعيد: 3 إنذارات فعّالة أو أكتر
    const byEmp = new Map();
    activeWarnings(records).forEach((r) => { (byEmp.get(r.profile_id) || byEmp.set(r.profile_id, []).get(r.profile_id)).push(r); });
    byEmp.forEach((list, pid) => {
      if (list.length < 3) return;
      const latest = list.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      const key = "escalate:" + latest.id;
      if (!open(pid, key)) return;
      out.push({
        type: "escalate", pid, key, reason: "misconduct", date: today, esc: true,
        title: `${nameOf(pid)}: وصل ${list.length} إنذارات خلال 12 شهر`,
        hint: "بعد الإنذار الثالث بنقترح خصم مالي، أو مراجعة قرار الاستمرار بالعمل. القرار إلك.",
        text: `تصعيد بعد ${list.length} إنذارات`,
      });
    });
    return out;
  }
  async function dismissSuggestion(s) {
    const { data: { session } } = await db().auth.getSession();
    const { error } = await db().from("hr_dismissed").upsert({ profile_id: s.pid, suggest_key: s.key, by_user: session && session.user.id });
    if (error) throw error;
  }

  // ---------------------------------------------------------------- نافذة التسجيل / التعديل
  let dlg = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "hr-dlg";
    dlg.setAttribute("aria-labelledby", "hr-dlg-title");
    document.body.appendChild(dlg);
    return dlg;
  }
  function chipsHtml(group, items, selected) {
    return `<div class="chips" data-group="${group}" role="radiogroup">${items.map(([k, l]) =>
      `<button type="button" class="hr-chip" role="radio" data-v="${k}" aria-checked="${k === selected}">${l}</button>`).join("")}</div>`;
  }

  // opts: { employees, profileId?, kind?: 'warning'|'deduction'|'bonus', reason?, text?, key?, source?, date?, edit?: record, records, onDone }
  function openRecordDialog(opts) {
    const d = ensureDialog();
    const edit = opts.edit || null;
    const emps = (opts.employees || []).filter((e) => e.is_active !== false);
    let kind = edit ? (isWarning(edit.kind) ? "warning" : edit.kind) : (opts.kind || "warning");
    let reason = edit ? edit.reason_code : (opts.reason || (kind === "bonus" ? "bonus_month" : "late"));
    let pid = edit ? edit.profile_id : (opts.profileId || (emps[0] && emps[0].id) || "");
    const records = opts.records || [];

    function draw() {
      const emp = emps.find((e) => e.id === pid) || (opts.employees || []).find((e) => e.id === pid) || {};
      const dayDefault = emp.hourly_wage ? Math.round(Number(emp.hourly_wage) * 8 * 100) / 100 : 0;
      const nextK = nextWarningKind(records, pid);
      const cur = d.querySelector("form") ? {
        text: d.querySelector("[name=text]").value, notes: d.querySelector("[name=notes]").value,
        fixed: (d.querySelector("[name=fixed]") || {}).value, days: (d.querySelector("[name=days]") || {}).value,
        dayv: (d.querySelector("[name=dayv]") || {}).value, date: d.querySelector("[name=date]").value,
      } : null;
      const v = cur || {
        text: edit ? edit.reason_text || "" : (opts.text || ""), notes: edit ? edit.notes || "" : "",
        fixed: edit ? (edit.fixed_amount || "") : "", days: edit && edit.deduct_days ? edit.deduct_days : "",
        dayv: edit && edit.day_value ? edit.day_value : "", date: edit ? edit.record_date : (opts.date || todayIso()),
      };
      const reasons = kind === "bonus" ? BONUS_REASONS : REASONS;
      if (!reasons[reason]) reason = kind === "bonus" ? "bonus_month" : "late";
      d.innerHTML = `<form method="dialog" novalidate>
        <div class="dh"><h2 id="hr-dlg-title">${edit ? "تعديل السجل" : "تسجيل جديد"}</h2><button type="button" class="btn small" data-x>إغلاق</button></div>
        <div class="db">
          ${edit ? `<div class="hint">${esc(emp.full_name || "")} · ${kindTag(edit.kind)}</div>` : `
          <label class="lbl" for="hr-emp">الموظف</label>
          <select id="hr-emp" name="emp">${emps.map((e) => `<option value="${e.id}"${e.id === pid ? " selected" : ""}>${esc(e.full_name || "بدون اسم")}</option>`).join("")}</select>
          <span class="lbl">النوع</span>
          ${chipsHtml("kind", [["warning", "إنذار"], ["deduction", "خصم مالي"], ["bonus", "مكافأة"]], kind)}`}
          ${kind === "warning" && !edit ? `<div class="hint">التصعيد تلقائي حسب سجله آخر 12 شهر: هالمرة بينسجّل <b>${KINDS[nextK].label}</b>.</div>` : ""}
          ${edit && isWarning(edit.kind) ? "" : ""}
          <span class="lbl">السبب</span>
          ${chipsHtml("reason", Object.entries(reasons), reason)}
          <label class="lbl" for="hr-text">التفاصيل (بتظهر بكشف الراتب وبنموذج الإنذار)</label>
          <input id="hr-text" name="text" maxlength="200" value="${esc(v.text)}" placeholder="مثال: تأخر نص ساعة ثلاث مرات هالأسبوع">
          ${kind === "deduction" ? `
          <div class="g3">
            <div><label class="lbl" for="hr-fixed">مبلغ ثابت (د.أ)</label><input id="hr-fixed" name="fixed" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(v.fixed)}"></div>
            <div><label class="lbl" for="hr-days">عدد أيام</label><input id="hr-days" name="days" type="number" step="0.5" min="0" inputmode="decimal" value="${esc(v.days)}"></div>
            <div><label class="lbl" for="hr-dayv">قيمة اليوم</label><input id="hr-dayv" name="dayv" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(v.dayv !== "" ? v.dayv : dayDefault || "")}"></div>
          </div>
          <div class="hint">بتقدر تحط مبلغ ثابت، أو أيام (بتتحول لمبلغ بقيمة اليوم، الافتراضي 8 ساعات × أجر الساعة)، أو الاثنين.</div>
          <div class="total"><span>إجمالي الخصم</span><span id="hr-total">0.00</span></div>` : ""}
          ${kind === "bonus" ? `
          <div><label class="lbl" for="hr-fixed">مبلغ المكافأة (د.أ)</label><input id="hr-fixed" name="fixed" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(v.fixed)}"></div>` : ""}
          <div class="g2">
            <div><label class="lbl" for="hr-date">التاريخ</label><input id="hr-date" name="date" type="date" value="${esc(v.date)}"></div>
          </div>
          <label class="lbl" for="hr-notes">ملاحظات داخلية (اختياري)</label>
          <textarea id="hr-notes" name="notes" maxlength="500">${esc(v.notes)}</textarea>
          ${kind !== "warning" ? `<div class="hint">${kind === "deduction" ? "الخصم" : "المكافأة"} بينضاف تلقائياً كبند على راتب الموظف ويظهر سببه بكشف الراتب.</div>` : ""}
          <div class="derr" id="hr-derr" role="alert"></div>
        </div>
        <div class="df"><button type="button" class="btn" data-x>إلغاء</button><button type="submit" class="btn gold" id="hr-save">${edit ? "حفظ التعديل" : "تسجيل"}</button></div>
      </form>`;
      const recalc = () => {
        const t = d.querySelector("#hr-total");
        if (!t) return;
        const f = Number(d.querySelector("[name=fixed]").value) || 0, ds = Number(d.querySelector("[name=days]").value) || 0, dv = Number(d.querySelector("[name=dayv]").value) || 0;
        t.textContent = money(f + ds * dv) + " د.أ";
      };
      d.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => d.close()));
      const sel = d.querySelector("#hr-emp");
      if (sel) sel.addEventListener("change", () => { pid = sel.value; draw(); });
      d.querySelectorAll("[data-group=kind] [data-v]").forEach((b) => b.addEventListener("click", () => {
        kind = b.dataset.v; reason = kind === "bonus" ? "bonus_month" : "late"; draw();
      }));
      d.querySelectorAll("[data-group=reason] [data-v]").forEach((b) => b.addEventListener("click", () => {
        reason = b.dataset.v;
        d.querySelectorAll("[data-group=reason] [data-v]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      }));
      ["fixed", "days", "dayv"].forEach((n) => { const el = d.querySelector(`[name=${n}]`); if (el) el.addEventListener("input", recalc); });
      recalc();
      d.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = d.querySelector("#hr-save"), err = d.querySelector("#hr-derr");
        err.textContent = ""; btn.disabled = true;
        try {
          const g = (n) => (d.querySelector(`[name=${n}]`) || {}).value;
          const fixed = Number(g("fixed")) || 0, days = Number(g("days")) || 0, dayv = Number(g("dayv")) || 0;
          if (!edit && !pid) throw new Error("اختار الموظف");
          if (kind === "deduction" && fixed + days * dayv <= 0) throw new Error("حدد مبلغ الخصم أو عدد الأيام");
          if (kind === "bonus" && fixed <= 0) throw new Error("حدد مبلغ المكافأة");
          if (kind === "warning" && !String(g("text")).trim() && reason === "other") throw new Error("اكتب تفاصيل السبب");
          if (edit) {
            const { error } = await db().rpc("hr_update_record", {
              p_id: edit.id, p_reason_code: reason, p_reason_text: g("text"), p_fixed: fixed, p_days: days, p_day_value: dayv, p_date: g("date"), p_notes: g("notes"),
            });
            if (error) throw error;
          } else {
            const { error } = await db().rpc("hr_create_record", {
              p_profile: pid, p_kind: kind, p_reason_code: reason, p_reason_text: g("text"), p_fixed: fixed, p_days: days, p_day_value: dayv,
              p_date: g("date") || todayIso(), p_notes: g("notes"), p_source: opts.source || "manual", p_suggest_key: opts.key || null,
            });
            if (error) throw error;
          }
          d.close();
          olvToast(edit ? "انحفظ التعديل" : "انسجّل", { type: "ok", icon: "check" });
          if (opts.onDone) opts.onDone();
        } catch (ex) {
          err.textContent = ex && ex.message ? ex.message : String(ex);
          btn.disabled = false;
        }
      });
    }
    draw();
    d.showModal();
  }

  async function cancelRecord(rec, onDone) {
    const reason = prompt(`إلغاء «${(KINDS[rec.kind] || {}).label || "السجل"}»؟ اكتب سبب الإلغاء (بيضل ظاهر بالسجل كـ«ملغي»):`);
    if (reason === null) return;
    try {
      const { error } = await db().rpc("hr_cancel_record", { p_id: rec.id, p_reason: reason });
      if (error) throw error;
      olvToast("انلغى السجل", { type: "info", icon: "check" });
      if (onDone) onDone();
    } catch (err) { olvToast(err.message || "تعذّر الإلغاء", { type: "danger", icon: "warning" }); }
  }

  // ---------------------------------------------------------------- نموذج الإنذار للطباعة
  function printForm(rec, emp, records) {
    const k = KINDS[rec.kind] || { label: "قرار" };
    const nth = isWarning(rec.kind)
      ? records.filter((r) => r.profile_id === rec.profile_id && r.status === "active" && isWarning(r.kind) && (r.record_date < rec.record_date || (r.record_date === rec.record_date && r.created_at <= rec.created_at))).length
      : 0;
    const title = isWarning(rec.kind) ? `إنذار رسمي — ${k.label.replace("إنذار ", "")}` : rec.kind === "deduction" ? "قرار خصم مالي" : "شهادة مكافأة";
    const base = location.href.replace(/[^/]*$/, "");
    const lines = [];
    if (rec.kind === "deduction") lines.push(`مبلغ الخصم: <b>${money(rec.amount)} د.أ</b>${Number(rec.deduct_days) ? ` (يشمل ${Number(rec.deduct_days)} يوم)` : ""}، بينخصم من راتبه ويظهر بكشف الراتب.`);
    if (rec.kind === "bonus") lines.push(`قيمة المكافأة: <b>${money(rec.amount)} د.أ</b>، بتنضاف لراتبه.`);
    if (rec.kind === "warning_final") lines.push("هذا الإنذار النهائي. أي مخالفة لاحقة بتعرّضه لإجراءات أشد قد توصل لإنهاء التعاقد.");
    if (rec.kind === "warning_written") lines.push("تكرار المخالفة بيؤدي لإنذار نهائي وإجراءات إضافية.");
    if (rec.kind === "warning_verbal") lines.push("هذا تنبيه رسمي أول موثّق، وتكرار المخالفة بيؤدي لإنذار خطي.");
    const w = window.open("", "_blank");
    if (!w) { olvToast("المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة", { type: "danger", icon: "warning" }); return; }
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)} — ${esc(emp.full_name || "")}</title>
<style>
@page{size:A4; margin:16mm}
*{box-sizing:border-box}
body{font-family:Tajawal,Arial,sans-serif; color:#1f1d2b; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact}
.hd{display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:3px solid #4254e8; padding-bottom:12px}
.logo{background:#0f0e0a; border-radius:12px; padding:8px 14px}.logo img{height:54px; display:block}
h1{font-size:26px; margin:0; color:#4254e8}.sub{color:#625d78; font-size:14px; margin-top:4px}
.box{border:1px solid #cfd0e6; border-radius:12px; padding:14px 18px; margin-top:18px}
.row{display:flex; gap:10px; padding:7px 0; border-bottom:1px dashed #e0e1f0; font-size:16px}.row:last-child{border:0}
.row span{color:#625d78; min-width:130px}.row b{flex:1}
.body{font-size:17px; line-height:2.1; min-height:110px; white-space:pre-wrap}
.sig{display:grid; grid-template-columns:repeat(3,1fr); gap:22px; margin-top:54px}
.sig div{border-top:1.5px solid #1f1d2b; padding-top:8px; text-align:center; font-size:14px}
.sig small{display:block; color:#625d78; margin-top:30px}
.ack{margin-top:30px; font-size:14px; color:#3b3850}
.ft{margin-top:26px; font-size:12px; color:#8a86a0; text-align:center}
</style></head><body>
<div class="hd"><div><h1>${esc(title)}</h1><div class="sub">محاسبة OLV · ${esc(fmtDate(rec.record_date))}${nth ? ` · الإنذار رقم ${nth}` : ""}</div></div>
<div class="logo"><img src="${base}assets/brand/olv-logo.png" alt="OLV"></div></div>
<div class="box">
<div class="row"><span>اسم الموظف</span><b>${esc(emp.full_name || "")}</b></div>
<div class="row"><span>المسمّى الوظيفي</span><b>${esc(emp.job_title || "—")}</b></div>
<div class="row"><span>نوع القرار</span><b>${esc(k.label)}</b></div>
<div class="row"><span>السبب</span><b>${esc(reasonLabel(rec.reason_code))}</b></div>
<div class="row"><span>التاريخ</span><b>${esc(rec.record_date)}</b></div>
</div>
<div class="box"><div class="sub" style="margin:0 0 6px">التفاصيل</div>
<div class="body">${esc(rec.reason_text || "—")}${lines.length ? "<br><br>" + lines.join("<br>") : ""}</div></div>
<div class="ack">أقرّ أنا الموقّع أدناه بأني اطّلعت على هذا القرار واستلمت نسخة منه.</div>
<div class="sig"><div>توقيع الموظف<small>التاريخ: ____ / ____ / ________</small></div><div>توقيع المدير<small>التاريخ: ____ / ____ / ________</small></div><div>توقيع صاحب المطعم<small>التاريخ: ____ / ____ / ________</small></div></div>
<div class="ft">OLV Café — نسخة للموظف ونسخة لملفه</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script>
</body></html>`);
    w.document.close();
  }

  window.OLV_HR = {
    KINDS, REASONS, BONUS_REASONS, reasonLabel, isWarning, kindTag, activeWarnings, nextWarningKind,
    loadRecords, loadSuggestions, dismissSuggestion, openRecordDialog, cancelRecord, printForm, fmtDate, addDays, todayIso,
  };
})();
