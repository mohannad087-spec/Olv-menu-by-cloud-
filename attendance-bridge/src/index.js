// برنامج جسر البصمة: يعمل باستمرار على نفس الجهاز يلي شغّال عليه جسر
// الطباعة (print-bridge)، يتصل بجهاز Hikvision (بروتوكول ISAPI عبر
// الشبكة، مصادقة Digest — راجع digest-client.js) ويسحب سجل أحداث التحكم
// بالدخول (كل نجاح تحقق: وجه/بصمة/كرت حسب الجهاز)، ويحفظ كل بصمة جديدة
// في جدول employee_punches بعد ما يطابقها بالموظف عبر عمود device_user_id
// (رقم الموظف "Employee No." المسجَّل على الجهاز نفسه عند تسجيل وجهه —
// يُضبط مرة وحدة من صفحة الموظفين). راجع README.md لخطوات التركيب.
//
// ليش نسحب نافذة زمنية كاملة كل مرة (LOOKBACK_HOURS ساعة للخلف) بدل
// تتبّع "آخر نقطة توقفنا عندها"؟ لأنه أبسط وأكثر أمانًا: قيد
// UNIQUE(profile_id, punched_at) بقاعدة البيانات + ON CONFLICT DO
// NOTHING (عبر ignoreDuplicates) يضمنان تجاهل أي بصمة سبق حفظها
// تلقائيًا، فمافي داعي لحفظ وتتبّع أي "مؤشر" هش قد ينكسر لو انقطع
// البرنامج أو أعيد تشغيله أو الجهاز نفسه.

require("dotenv").config();
const { searchAllAcsEvents } = require("./hikvision");
const { supabase } = require("./supabase");

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 80);
const DEVICE_USER = process.env.DEVICE_USER || "admin";
const DEVICE_PASSWORD = process.env.DEVICE_PASSWORD;
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 72);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);

if (!DEVICE_IP || !DEVICE_PASSWORD) {
  console.error("خطأ: تأكد من ضبط DEVICE_IP و DEVICE_PASSWORD في ملف .env");
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toLocaleTimeString("ar-EG", { numberingSystem: "latn" })}]`, ...args);
}

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
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_HOURS * 3600000);

    const [userMap, events] = await Promise.all([
      loadDeviceUserMap(),
      searchAllAcsEvents({
        host: DEVICE_IP, port: DEVICE_PORT, username: DEVICE_USER, password: DEVICE_PASSWORD,
        startTime: from.toISOString(), endTime: now.toISOString(),
      }),
    ]);

    if (!events.length) {
      log("لا يوجد أحداث جديدة على الجهاز خلال آخر", LOOKBACK_HOURS, "ساعة.");
      return;
    }

    const rows = [];
    const unmapped = new Set();
    for (const ev of events) {
      const employeeNo = String(ev.employeeNoString || "").trim();
      const punchTime = ev.time;
      if (!employeeNo || !punchTime) continue; // حدث نظام/تنبيه مو مرتبط بموظف — نتجاهله
      const profileId = userMap.get(employeeNo);
      if (!profileId) {
        unmapped.add(employeeNo);
        continue;
      }
      rows.push({
        profile_id: profileId,
        punched_at: new Date(punchTime).toISOString(),
        source: "fingerprint",
      });
    }

    if (unmapped.size) {
      log(`تحذير: بصمات من رقم/أرقام موظفين غير مربوطة بأي حساب (${[...unmapped].join("، ")}) — اربط "رقم الموظف على جهاز البصمة" من صفحة الموظفين.`);
    }

    if (rows.length) {
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("employee_punches")
          .upsert(chunk, { onConflict: "profile_id,punched_at", ignoreDuplicates: true });
        if (error) throw error;
      }
      log(`تمت مزامنة ${rows.length} بصمة من الجهاز (البصمات المحفوظة مسبقًا تُتجاهل تلقائيًا).`);
    } else {
      log("لا يوجد بصمات جديدة مربوطة بموظفين خلال هذه الدورة.");
    }
  } catch (err) {
    log("خطأ أثناء دورة فحص البصمة:", err.message);
  } finally {
    setTimeout(tick, POLL_INTERVAL_MS);
  }
}

log("بدء تشغيل برنامج جسر البصمة (Hikvision ISAPI)...");
log(`يفحص جهاز الحضور كل ${POLL_INTERVAL_MS / 1000} ثانية (نافذة ${LOOKBACK_HOURS} ساعة للخلف في كل مرة). اتركه يعمل باستمرار.`);
tick();
