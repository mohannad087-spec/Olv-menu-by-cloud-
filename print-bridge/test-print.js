// أداة اختبار مستقلة عن Supabase: تطبع تذكرة تجريبية بسيطة على أي طابعة
// تعطيها عنوان IP لها، للتأكد من أن التوصيل الشبكي يعمل قبل ربط النظام كله.
//
// طريقة الاستخدام:
//   node test-print.js 192.168.1.50
//   node test-print.js 192.168.1.50 9100

const { TicketBuilder } = require("./src/ticket-builder");
const { buildTicketBuffer } = require("./src/escpos");
const { sendToPrinter } = require("./src/printer");

const ip = process.argv[2];
const port = Number(process.argv[3] || 9100);

if (!ip) {
  console.error("الاستخدام: node test-print.js <عنوان IP الطابعة> [المنفذ، افتراضيًا 9100]");
  process.exit(1);
}

const t = new TicketBuilder();
t.center("اختبار طباعة", "bold 36px Tajawal-Bold", 50);
t.spacer(10);
t.divider();
t.spacer(14);
t.right("إذا وصلتك هذه الورقة، فالطابعة", "26px Tajawal", 36);
t.right("متصلة بشكل صحيح ببرنامج جسر الطباعة.", "26px Tajawal", 36);
t.spacer(10);
t.right(`الوقت: ${new Date().toLocaleString("ar-EG", { numberingSystem: "latn" })}`, "22px Tajawal", 32);
t.spacer(16);
t.divider();

const canvas = t.build();
const buffer = buildTicketBuffer(canvas);

console.log(`جاري إرسال تذكرة اختبار إلى ${ip}:${port} ...`);
sendToPrinter(ip, port, buffer)
  .then(() => console.log("✓ تم الإرسال بنجاح. تحقق من الطابعة."))
  .catch((err) => {
    console.error("✗ فشل الإرسال:", err.message);
    process.exit(1);
  });
