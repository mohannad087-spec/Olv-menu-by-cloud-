const path = require("path");
const os = require("os");
const { fetchDayData, buildWorkbook } = require("./report");
const { uploadToDrive } = require("./drive");

// بيحسب تاريخ "أمس" باليوم المحاسبي الصحيح حسب منطقة المطعم الزمنية،
// بغض النظر شو التوقيت اللي اشتغل فيه هذا السكربت فعليًا (GitHub Actions
// دايمًا UTC). بيبني منتصف نهار UTC لتاريخ اليوم بمنطقة المطعم، وبعدين
// يطرح يوم كامل — هيك بيتفادى مشاكل حدود التوقيت الصيفي/الشتوي
function yesterdayInTimezone(timeZone) {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now); // YYYY-MM-DD
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayNoonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const yesterdayNoonUtc = new Date(todayNoonUtc.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(yesterdayNoonUtc);
}

(async () => {
  const timeZone = process.env.TIMEZONE || "Asia/Amman";
  // BACKUP_DATE اختياري — لتشغيل يدوي على تاريخ محدد بدل "أمس" تلقائيًا
  const dateStr = process.env.BACKUP_DATE || yesterdayInTimezone(timeZone);
  console.log(`جاري تجهيز تقرير يوم ${dateStr}...`);

  const data = await fetchDayData(dateStr);
  console.log(`عدد الطلبات: ${data.sales.length} — عدد المصروفات: ${data.expenses.length}`);

  const wb = buildWorkbook(dateStr, data, timeZone);

  const fileName = `تقرير-محاسبة-OLV-${dateStr}.xlsx`;
  const filePath = path.join(os.tmpdir(), fileName);
  await wb.xlsx.writeFile(filePath);
  console.log(`تم بناء الملف: ${filePath}`);

  const uploaded = await uploadToDrive(filePath, fileName);
  console.log(`تم الرفع لـ Google Drive: ${uploaded.webViewLink || uploaded.id}`);
})().catch((err) => {
  console.error("فشل النسخ الاحتياطي:", err);
  process.exit(1);
});
