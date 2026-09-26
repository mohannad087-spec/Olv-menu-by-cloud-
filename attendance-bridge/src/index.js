// برنامج جسر البصمة: يعمل باستمرار على نفس الجهاز يلي شغّال عليه جسر
// الطباعة (print-bridge)، يتصل بجهاز بصمة (بروتوكول ZK) على شبكة
// المطعم، ويسحب سجل الحضور الكامل كل دورة فحص، ويحفظ كل بصمة جديدة في
// جدول employee_punches بعد ما يطابقها بالموظف عبر عمود device_user_id
// (رقم الموظف المسجّل على جهاز البصمة نفسه — يُضبط مرة وحدة من صفحة
// الموظفين). راجع README.md لخطوات التركيب والتشغيل.
//
// ليش نسحب السجل الكامل من الجهاز كل مرة بدل تتبّع "آخر نقطة توقفنا
// عندها"؟ لأنه أبسط وأكثر أمانًا: قيد UNIQUE(profile_id, punched_at) في
// قاعدة البيانات + ON CONFLICT DO NOTHING (عبر ignoreDuplicates) يضمنان
// تجاهل أي بصمة سبق حفظها تلقائيًا، فمافي داعي لحفظ وتتبّع أي "مؤشر" هش
// قد ينكسر لو انقطع البرنامج أو أعيد تشغيله أو الجهاز نفسه.

require("dotenv").config();
const ZKLib = require("node-zklib");
const { supabase } = require("./supabase");

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);

if (!DEVICE_IP) {
  console.error("خطأ: تأكد من ضبط DEVICE_IP في ملف .env");
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString("ar-EG", { numberingSystem: "latn" })}]`, ...args);
}

let zk = null;

async function ensureConnected() {
  if (zk) return zk;
  log("يتصل بجهاز البصمة...");
  const instance = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);
  await instance.createSocket();
  zk = instance;
  log("تم الاتصال بجهاز البصمة.");
  return zk;
}

// خريطة "رقم الموظف على الجهاز" -> "معرّف الموظف بقاعدة البيانات"،
// نحدّثها كل دورة فحص حتى تنعكس أي إضافة/تعديل جديد من صفحة الموظفين
async function loadDeviceUserMap() {
  const { data, error } = await supabase
    .from("profiles").select("id, device_user_id").not("device_user_id", "is", null);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) map.set(String(row.device_user_id), row.id);
  return map;
}

async function tick() {
  try {
    const instance = await ensureConnected();
    const [userMap, attendance] = await Promise.all([
      loadDeviceUserMap(),
      instance.getAttendances(),
    ]);

    const records = (attendance && attendance.data) || [];
    if (!records.length) {
      log("لا يوجد بصمات جديدة على الجهاز.");
      return;
    }

    const rows = [];
    const unmapped = new Set();
    for (const rec of records) {
      const deviceUserId = String(rec.deviceUserId ?? rec.userSn ?? "");
      const profileId = userMap.get(deviceUserId);
      if (!profileId) {
        unmapped.add(deviceUserId);
        continue;
      }
      rows.push({
        profile_id: profileId,
        punched_at: new Date(rec.recordTime).toISOString(),
        source: "fingerprint",
      });
    }

    if (unmapped.size) {
      log(`تحذير: بصمات من رقم/أرقام غير مربوطة بأي موظف (${[...unmapped].join("، ")}) — اربط "رقم الموظف على جهاز البصمة" من صفحة الموظفين.`);
    }

    if (rows.length) {
      // نرسلها على دفعات حتى لا نتجاوز حجم الطلب المسموح لو تراكم سجل
      // كبير (مثلاً بعد انقطاع طويل عن الجهاز)
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("employee_punches")
          .upsert(chunk, { onConflict: "profile_id,punched_at", ignoreDuplicates: true });
        if (error) throw error;
      }
      log(`تمت مزامنة ${rows.length} بصمة من الجهاز (البصمات المحفوظة مسبقًا تُتجاهل تلقائيًا).`);
    }
  } catch (err) {
    log("خطأ أثناء دورة فحص البصمة:", err.message);
    // أي خطأ اتصال (انقطاع الشبكة، إعادة تشغيل الجهاز) بيخلي الاتصال
    // القديم عالق — نرميه حتى تُعاد المحاولة بمقبس جديد بالدورة الجاية
    try { if (zk) await zk.disconnect(); } catch (_) { /* تجاهل */ }
    zk = null;
  } finally {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

log("بدء تشغيل برنامج جسر البصمة...");
log(`يفحص جهاز البصمة كل ${POLL_INTERVAL_MS / 1000} ثانية. اتركه يعمل باستمرار.`);
tick();
