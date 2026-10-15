// وسيط رقيق فوق digest-client.js يعرف تحديدًا كيف يسأل جهاز Hikvision
// (بروتوكول ISAPI) عن سجل أحداث التحكم بالدخول (AcsEvent) — وهو نفس
// السجل اللي بيتسجل فيه كل نجاح تحقق (وجه/بصمة/كرت/كلمة سر حسب الجهاز).
const { digestRequest } = require("./digest-client");

// ISAPI يتوقع وقت بصيغة 2026-10-14T20:00:00+03:00 (بدون أجزاء ثانية، مع إزاحة المنطقة الزمنية)
function toIsapiTime(input) {
  const d = new Date(input);
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// صفحة وحدة من سجل الأحداث بين وقتين، بترقيم position/maxResults حسب
// معيار ISAPI (major=5 يعني "أحداث التحكم بالدخول" شاملة كل طرق التحقق)
async function searchAcsEventsPage({ host, port, username, password, searchID, position, maxResults, startTime, endTime }) {
  const res = await digestRequest({
    host, port, username, password,
    method: "POST",
    path: "/ISAPI/AccessControl/AcsEvent?format=json",
    body: {
      AcsEventCond: {
        searchID,
        searchResultPosition: position,
        maxResults,
        major: 5,
        minor: 0,
        startTime: toIsapiTime(startTime),
        endTime: toIsapiTime(endTime),
      },
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`جهاز الحضور رفض الطلب (HTTP ${res.statusCode}): ${res.body.slice(0, 300)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    throw new Error("رد غير متوقع من جهاز الحضور (مو JSON صالح): " + res.body.slice(0, 200));
  }
  return parsed.AcsEvent || parsed;
}

// يسحب كل صفحات النتائج بين وقتين (يزيد searchResultPosition تلقائيًا)
// ويرجعها كقائمة واحدة مسطّحة — بحد أقصى أماني لعدد الصفحات حتى ما يعلق
// البرنامج لو رجّع الجهاز شي غير متوقع
async function searchAllAcsEvents({ host, port, username, password, startTime, endTime, pageSize = 30, maxPages = 300 }) {
  const all = [];
  const searchID = `olv-${Date.now()}`;
  let position = 0;
  for (let page = 0; page < maxPages; page++) {
    const result = await searchAcsEventsPage({
      host, port, username, password, searchID, position, maxResults: pageSize, startTime, endTime,
    });
    const items = result.InfoList || [];
    all.push(...items);
    const total = Number(result.totalMatches);
    position += items.length;
    if (!items.length) break;
    if (!Number.isNaN(total) && position >= total) break;
    if (items.length < pageSize) break;
  }
  return all;
}

// قائمة الأشخاص المسجّلين على الجهاز (الرقم الوظيفي + الاسم) لربطهم بالموظفين بالاسم
async function listDeviceUsers({ host, port, username, password, pageSize = 30, maxPages = 50 }) {
  const out = [];
  const searchID = `olv-u-${Date.now()}`;
  let position = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await digestRequest({
      host, port, username, password,
      method: "POST",
      path: "/ISAPI/AccessControl/UserInfo/Search?format=json",
      body: { UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults: pageSize } },
    });
    if (res.statusCode !== 200) throw new Error(`تعذر قراءة أسماء الموظفين من الجهاز (HTTP ${res.statusCode})`);
    const r = JSON.parse(res.body).UserInfoSearch || {};
    const items = r.UserInfo || [];
    for (const u of items) if (u.employeeNo) out.push({ employeeNo: String(u.employeeNo), name: String(u.name || "") });
    position += items.length;
    if (!items.length || items.length < pageSize || position >= Number(r.totalMatches || 0)) break;
  }
  return out;
}

module.exports = { searchAllAcsEvents, listDeviceUsers };
