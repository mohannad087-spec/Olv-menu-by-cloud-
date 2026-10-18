// حالة النسخة الاحتياطية الليلية على Google Drive (drive-backup/): البرنامج الليلي بيكتب سطر
// 'last_backup' بجدول app_settings بعد كل تشغيل (نجح أو فشل)، وهاد بيقراه.
//   olvLoadBackupStatus() ← { state: "ok" | "old" | "failed" | "none" | "unknown", text, link }
//     ok = آخر نسخة ناجحة من يومين أو أقل | old = أقدم | failed = آخر تشغيل فشل
//     none = ما اشتغل أبدًا (أو ما انربط) | unknown = ما في صلاحية تقرا
(function () {
  async function olvLoadBackupStatus() {
    const { data, error } = await window.supabaseClient.from("app_settings").select("value").eq("key", "last_backup").maybeSingle();
    if (error) return { state: "unknown", text: "ما قدرنا نقرا حالة النسخة الاحتياطية" };
    if (!data || !data.value) return { state: "none", text: "النسخة الاحتياطية الليلية لسا ما اشتغلت (أو ما انربطت). الخطوات بملف drive-backup/README.md." };
    let v;
    try { v = JSON.parse(data.value); } catch (_) { return { state: "unknown", text: "حالة النسخة الاحتياطية مش مقروءة" }; }
    const at = v.at ? new Date(v.at) : null;
    const when = at && !isNaN(at) ? at.toLocaleString("ar", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", numberingSystem: "latn" }) : "";
    if (v.ok === false) return { state: "failed", text: `آخر تشغيل فشل${when ? " (" + when + ")" : ""}${v.error ? ": " + v.error : ""}`, link: null };
    const days = at && !isNaN(at) ? (Date.now() - at.getTime()) / 864e5 : null;
    const base = `آخر نسخة ناجحة: ${when || "—"}${v.date ? " (تقرير يوم " + v.date + ")" : ""}`;
    if (days != null && days > 2) return { state: "old", text: `${base}. صار لها أكتر من يومين، تأكد إنها شغّالة.`, link: v.link || null };
    return { state: "ok", text: base, link: v.link || null };
  }
  window.olvLoadBackupStatus = olvLoadBackupStatus;
})();
