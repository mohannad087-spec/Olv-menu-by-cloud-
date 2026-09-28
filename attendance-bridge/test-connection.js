// سكربت تشخيصي: اختبار الاتصال بجهاز الحضور لوحده، قبل تشغيل البرنامج
// الكامل (src/index.js). شغّله أول شي بعد ضبط .env — إذا نجح، البرنامج
// الكامل جاهز يشتغل. إذا فشل، الرسالة بتوضحلك السبب الأرجح.
//
// تنبيه مهم: الجزء اللي بيسحب سجل البصمات (AcsEvent) ما قدرنا نختبره
// على جهاز Hikvision حقيقي وقت كتابة هالبرنامج (اختُبر منطق المصادقة
// والترقيم بمحاكاة دقيقة، لكن مو على الجهاز الفعلي). لهذا هالسكربت
// بيطبع الرد الخام (raw JSON) كامل من الجهاز — لو الشكل مختلف عن المتوقع،
// انسخ الناتج وابعتلي إياه حتى نصحح src/hikvision.js لو احتاج الأمر.

require("dotenv").config();
const { digestRequest } = require("./src/digest-client");
const { searchAllAcsEvents } = require("./src/hikvision");

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 80);
const DEVICE_USER = process.env.DEVICE_USER || "admin";
const DEVICE_PASSWORD = process.env.DEVICE_PASSWORD;

if (!DEVICE_IP || !DEVICE_PASSWORD) {
  console.error("خطأ: تأكد من ضبط DEVICE_IP و DEVICE_PASSWORD في ملف .env أولًا");
  process.exit(1);
}

async function main() {
  console.log(`يتصل بـ ${DEVICE_IP}:${DEVICE_PORT} باسم المستخدم "${DEVICE_USER}"...\n`);

  console.log("--- 1) اختبار الاتصال الأساسي والمصادقة (System/deviceInfo) ---");
  try {
    const res = await digestRequest({
      host: DEVICE_IP, port: DEVICE_PORT, username: DEVICE_USER, password: DEVICE_PASSWORD,
      method: "GET", path: "/ISAPI/System/deviceInfo?format=json",
    });
    if (res.statusCode === 200) {
      console.log("✓ نجح الاتصال والمصادقة. رد الجهاز:");
      console.log(res.body);
    } else {
      console.log(`✗ فشل — الجهاز رد بحالة HTTP ${res.statusCode}`);
      console.log(res.body);
      if (res.statusCode === 401) {
        console.log("\nغالبًا اسم المستخدم أو كلمة السر غلط — تأكد أنهم نفس بيانات الدخول اللي ضبطتها وقت تفعيل الجهاز.");
      }
      return;
    }
  } catch (err) {
    console.log("✗ فشل الاتصال:", err.message);
    console.log("\nتأكد من:");
    console.log("- الجهاز والكمبيوتر على نفس الشبكة (نفس الواي فاي/الراوتر)");
    console.log("- عنوان DEVICE_IP صحيح (جرّب تفتحه من متصفح: http://" + DEVICE_IP + ")");
    console.log("- المنفذ DEVICE_PORT صحيح (80 هو الافتراضي)");
    return;
  }

  console.log("\n--- 2) اختبار سحب سجل الأحداث لآخر 24 ساعة (AcsEvent) ---");
  try {
    const events = await searchAllAcsEvents({
      host: DEVICE_IP, port: DEVICE_PORT, username: DEVICE_USER, password: DEVICE_PASSWORD,
      startTime: new Date(Date.now() - 24 * 3600000).toISOString(),
      endTime: new Date().toISOString(),
      pageSize: 10,
    });
    console.log(`✓ نجح — عدد الأحداث المسحوبة: ${events.length}`);
    if (events.length) {
      console.log("\nأول 3 أحداث (كاملة، للفحص اليدوي):");
      console.log(JSON.stringify(events.slice(0, 3), null, 2));
      const withEmployee = events.filter((e) => e.employeeNoString);
      console.log(`\nمنها ${withEmployee.length} حدث فيه رقم موظف (employeeNoString) — هاد الرقم لازم يتطابق مع "رقم الموظف على جهاز البصمة" بصفحة الموظفين.`);
    } else {
      console.log("ما في أي حدث بآخر 24 ساعة — جرّب تبصم على الجهاز الآن وشغّل السكربت من جديد للتأكد.");
    }
  } catch (err) {
    console.log("✗ فشل سحب سجل الأحداث:", err.message);
    console.log("انسخ هذه الرسالة وأي رد خام ظهر فوقها وابعتها حتى نراجع الكود.");
  }
}

main();
