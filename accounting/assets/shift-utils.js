// يحوّل قائمة بصمات مجرّدة (employee_punches) إلى "ورديات" (دخول/خروج)
// بترقيم تسلسلي لكل موظف بكل يوم حسب الترتيب الزمني، وتزويج كل بصمتين
// متتاليتين — نفس المنطق تمامًا المستخدم بـview employee_shifts
// (schema-attendance.sql)، معاد حسابه هون (بدل الاستعلام من الـview
// مباشرة) حتى يبقى معنا معرّف (id) كل بصمة على حدة، للتعديل/الحذف
// (attendance.html) ولحساب ساعات العمل (payroll.html).
function olvComputeShifts(punches) {
  const byKey = new Map();
  punches.forEach((p) => {
    const day = p.punched_at.slice(0, 10);
    const key = p.profile_id + "|" + day;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  });
  const shifts = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
    const [profileId, day] = key.split("|");
    for (let i = 0; i < list.length; i += 2) {
      shifts.push({
        key: key + "|" + i,
        profile_id: profileId,
        work_date: day,
        clockIn: list[i],
        clockOut: list[i + 1] || null,
      });
    }
  }
  return shifts;
}

// عدد الساعات بين وقتين، أو null لو أي منهم مفقود (وردية لسا مفتوحة)
function olvHoursBetween(a, b) {
  if (!a || !b) return null;
  return (new Date(b) - new Date(a)) / 3600000;
}
