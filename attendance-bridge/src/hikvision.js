// وسيط رقيق فوق digest-client.js يعرف تحديدًا كيف يسأل جهاز Hikvision
// (بروتوكول ISAPI) عن سجل أحداث التحكم بالدخول (AcsEvent) — وهو نفس
// السجل اللي بيتسجل فيه كل نجاح تحقق (وجه/بصمة/كرت/كلمة سر حسب الجهاز).
const { digestRequest } = require("./digest-client");

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
        startTime,
        endTime,
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

module.exports = { searchAllAcsEvents };
