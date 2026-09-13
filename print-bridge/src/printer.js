const net = require("net");

// يرسل البيانات الخام إلى الطابعة عبر منفذ الشبكة (عادة 9100) مباشرة،
// وهو المنفذ القياسي لطباعة ESC/POS الخام في تقريبًا كل الطابعات
// الحرارية الشبكية من Epson وStar وغيرها
function sendToPrinter(ip, port, buffer, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(new Error(`انتهت مهلة الاتصال بالطابعة ${ip}:${port}`)));
    socket.once("error", (err) => finish(new Error(`تعذّر الاتصال بالطابعة ${ip}:${port} — ${err.message}`)));

    socket.connect(port, ip, () => {
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        finish(null);
      });
    });
  });
}

module.exports = { sendToPrinter };
