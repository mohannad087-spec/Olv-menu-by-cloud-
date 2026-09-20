const { google } = require("googleapis");
const fs = require("fs");

async function uploadToDrive(filePath, fileName) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  if (!raw || !folderId) {
    console.error("خطأ: تأكد من ضبط GOOGLE_SERVICE_ACCOUNT_JSON و GDRIVE_BACKUP_FOLDER_ID");
    process.exit(1);
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    console.error("خطأ: GOOGLE_SERVICE_ACCOUNT_JSON مو JSON صالح (تأكد من نسخ محتوى الملف كامل بدون تعديل)");
    process.exit(1);
  }

  // نطاق drive.file المحدود (مو drive الكامل) — الحساب بيقدر بس يشوف/يعدّل
  // الملفات اللي هو نفسه أنشأها، مش كل ملفات الدرايف المشترك معه
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: fs.createReadStream(filePath),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return res.data;
}

module.exports = { uploadToDrive };
