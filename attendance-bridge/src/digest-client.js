// عميل HTTP بسيط يدعم Digest Authentication (RFC 2617) يدويًا، بدون أي
// مكتبة خارجية — أجهزة Hikvision (وأغلب أجهزة التحكم بالدخول ISAPI)
// تتطلب هذا النوع من المصادقة، وتطبيقه يدويًا هون (بدل الاعتماد على حزمة
// npm قليلة الصيانة أو غير موثوقة) بيخلينا متأكدين تمامًا من سلوكه.
//
// الآلية: أول طلب بدون ترويسة Authorization بيرجع 401 مع تفاصيل التحدي
// (realm, nonce...) بترويسة WWW-Authenticate، وبعدين نبني ترويسة
// Authorization صحيحة ونعيد الطلب مرة تانية. نعيد كامل هالخطوتين مع كل
// طلب (بدل حفظ/تدوير nonce واحد لعدة طلبات) — أبسط وأضمن لبرنامج بيبعت
// طلب وحدة كل بضع ثواني بس.
const http = require("http");
const crypto = require("crypto");

function md5(s) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

function parseDigestChallenge(header) {
  const out = {};
  const re = /(\w+)=("([^"]*)"|[^,]+)/g;
  let m;
  while ((m = re.exec(header))) {
    out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  }
  return out;
}

function rawRequest({ host, port, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path, headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("انتهت مهلة الاتصال بجهاز الحضور — تأكد أنه على نفس الشبكة وشغّال")));
    if (body) req.write(body);
    req.end();
  });
}

let cnonceCounter = 0;

// يبني ترويسة Authorization: Digest صحيحة استجابة لتحدي الجهاز
function buildDigestAuthHeader({ challenge, username, password, method, path }) {
  const qopList = (challenge.qop || "").split(",").map((s) => s.trim());
  const qop = qopList.includes("auth") ? "auth" : (challenge.qop || undefined);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex") + (++cnonceCounter);
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${path}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  let value = `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${path}", response="${response}"`;
  if (qop) value += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (challenge.opaque) value += `, opaque="${challenge.opaque}"`;
  return value;
}

// طلب HTTP كامل بمصادقة Digest تلقائية. body (إن وُجد) كائن JS بيتحوّل
// JSON تلقائيًا. بيرجع { statusCode, headers, body: string }
async function digestRequest({ host, port, username, password, method, path, body }) {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  const baseHeaders = bodyStr ? { "content-type": "application/json" } : {};

  const first = await rawRequest({ host, port, method, path, headers: baseHeaders, body: bodyStr });
  if (first.statusCode !== 401) return first;

  const authHeader = first.headers["www-authenticate"];
  if (!authHeader) throw new Error("الجهاز رفض الاتصال (401) بدون تفاصيل مصادقة — تأكد من اسم المستخدم وكلمة السر");
  const challenge = parseDigestChallenge(authHeader);
  const authValue = buildDigestAuthHeader({ challenge, username, password, method, path });

  return rawRequest({
    host, port, method, path,
    headers: Object.assign({}, baseHeaders, { authorization: authValue }),
    body: bodyStr,
  });
}

module.exports = { digestRequest };
