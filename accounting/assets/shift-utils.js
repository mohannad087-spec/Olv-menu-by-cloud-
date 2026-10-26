// يحوّل قائمة بصمات مجرّدة (employee_punches) إلى "ورديات" — وردية وحدة لكل موظف بكل يوم دوام:
// دخول = أول بصمة باليوم، خروج = آخر بصمة، وأي بصمات بينهم (الجهاز بيسجّل أكتر من مرة) بتنتجاهل.
// يوم الدوام بيبدأ 04:00 بتوقيت عمّان (نفس دالة attendance_daily بقاعدة البيانات، schema-attendance-summary.sql)،
// فالدوام اللي بيعدّي نص الليل بيضل بيومه. اليوم ببصمة وحدة = ناقص خروج (clockOut = null)،
// واليوم اللي فرق بصماته أقل من 30 دقيقة (تسجيل/تجربة) بينعلّم ignored وساعاته صفر.
// بنرجّع معرّف (id) كل البصمات (ids) حتى الحذف يشيل اليوم كامل، ومعرّف الأولى والأخيرة للتعديل (attendance.html).
const OLV_MIN_SHIFT_MIN = 30;
const OLV_WORKDAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" });

// يوم الدوام (YYYY-MM-DD) لوقت بصمة (ISO)
function olvWorkDay(iso) {
  return OLV_WORKDAY_FMT.format(new Date(new Date(iso).getTime() - 4 * 3600000));
}

// حدود فترة تواريخ [from, to] كأوقات ISO لاستعلام البصمات (يوم الدوام بيبدأ 04:00 عمّان = 01:00 UTC)
function olvWorkRangeBounds(from, to) {
  const next = new Date(to + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  return { gte: from + "T01:00:00Z", lt: next.toISOString().slice(0, 10) + "T01:00:00Z" };
}

function olvComputeShifts(punches) {
  const byKey = new Map();
  punches.forEach((p) => {
    const key = p.profile_id + "|" + olvWorkDay(p.punched_at);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  });
  const shifts = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
    const [profileId, day] = key.split("|");
    const first = list[0], last = list.length > 1 ? list[list.length - 1] : null;
    const ignored = !!last && (new Date(last.punched_at) - new Date(first.punched_at)) / 60000 < OLV_MIN_SHIFT_MIN;
    shifts.push({
      key,
      profile_id: profileId,
      work_date: day,
      clockIn: first,
      clockOut: last,
      punch_count: list.length,
      ids: list.map((p) => p.id),
      ignored,
    });
  }
  return shifts;
}

// عدد الساعات بين وقتين، أو null لو أي منهم مفقود (وردية لسا مفتوحة)
function olvHoursBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / 3600000;
}

// ساعات وردية: null = ناقص خروج، 0 = يوم مهمل (أقل من 30 دقيقة)
function olvShiftHours(s) {
  if (s.ignored) return 0;
  return olvHoursBetween(s.clockIn.punched_at, s.clockOut ? s.clockOut.punched_at : null);
}
