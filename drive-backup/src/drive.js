const { google } = require("googleapis");
const fs = require("fs");

async function uploadToDrive(filePath, fileName) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    console.error("خطأ: تأكد من ضبط GOOGLE_OAUTH_CLIENT_ID و GOOGLE_OAUTH_CLIENT_SECRET و GOOGLE_OAUTH_REFRESH_TOKEN و GDRIVE_BACKUP_FOLDER_ID");
    process.exit(1);
  }

  // الرفع برخصة حساب Google الشخصي (OAuth) بدل حساب خدمة — حسابات الخدمة
  // ما إلها مساحة تخزين خاصة فيها، فما تقدر تنشئ ملفات جديدة بحساب Drive
  // شخصي عادي (غير Google Workspace) حتى لو معطاة صلاحية Editor على المجلد
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: fs.createReadStream(filePath),
    },
    fields: "id, webViewLink",
  });
  return res.data;
}

module.exports = { uploadToDrive };
