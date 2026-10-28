const net = require("net");

// يرسل البيانات الخام إلى الطابعة عبر منفذ الشبكة (عادة 9100) مباشرة،
// وهو المنفذ القياسي لطباعة ESC/POS الخام في تقريبًا كل الطابعات
// الحرارية الشبكية من Epson وStar وغيرها.
// الخطأ بيحمل beforeConnect = true لو الفشل صار قبل ما الاتصال يتم (ما انبعت ولا بايت)،
// وبهالحالة بس إعادة المحاولة آمنة (بعد الاتصال ممكن التذكرة تكون انطبعت فبتتكرر)
function sendOnce(ip, port, buffer, connectTimeoutMs, writeTimeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let connected = false;
    let connectTimer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      socket.destroy();
      if (err) { err.beforeConnect = !connected; reject(err); }
      else resolve();
    };

    connectTimer = setTimeout(() => finish(new Error(`انتهت مهلة الاتصال بالطابعة ${ip}:${port}`)), connectTimeoutMs);
    socket.once("error", (err) => finish(new Error(`تعذّر الاتصال بالطابعة ${ip}:${port} — ${err.message}`)));

    socket.connect(port, ip, () => {
      connected = true;
      clearTimeout(connectTimer);
      socket.setTimeout(writeTimeoutMs);
      socket.once("timeout", () => finish(new Error(`انتهت مهلة إرسال البيانات للطابعة ${ip}:${port}`)));
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        finish(null);
      });
    });
  });
}

// اتصال الطابعة الشبكية بيفشل أحيانًا لحظيًا (واي فاي، طابعة بتصحى من السكون)، ومحاولة تانية بعد ثانية بتنجح عادة.
// بنعيد بس لو الفشل قبل الاتصال، بمحاولات قصيرة بدل مهلة وحدة طويلة (٣ × ٣ ثواني)
const ATTEMPTS = Number(process.env.PRINTER_ATTEMPTS || 3);
const CONNECT_TIMEOUT_MS = Number(process.env.PRINTER_CONNECT_TIMEOUT_MS || 3000);
const WRITE_TIMEOUT_MS = Number(process.env.PRINTER_WRITE_TIMEOUT_MS || 8000);
const RETRY_PAUSE_MS = 400;

async function sendToPrinter(ip, port, buffer, onRetry) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await sendOnce(ip, port, buffer, CONNECT_TIMEOUT_MS, WRITE_TIMEOUT_MS);
      return;
    } catch (err) {
      lastErr = err;
      if (!err.beforeConnect || attempt === ATTEMPTS) break;
      if (typeof onRetry === "function") onRetry(attempt, err);
      await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    }
  }
  if (lastErr && lastErr.beforeConnect && ATTEMPTS > 1) lastErr.message += ` (بعد ${ATTEMPTS} محاولات)`;
  throw lastErr;
}

module.exports = { sendToPrinter };
