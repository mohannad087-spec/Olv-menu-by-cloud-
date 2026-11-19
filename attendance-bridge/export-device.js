// يسحب كل سجل الحضور المخزّن على جهاز البصمة نفسه (بدون قاعدة البيانات) ويحفظه بملف CSV يفتح بإكسل.
// بيستعمل نفس إعدادات .env (DEVICE_IP / DEVICE_PASSWORD...). التشغيل: export.bat
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { searchAllAcsEvents, listDeviceUsers } = require("./src/hikvision");

const host = process.env.DEVICE_IP;
const port = Number(process.env.DEVICE_PORT || 80);
const username = process.env.DEVICE_USER || "admin";
const password = process.env.DEVICE_PASSWORD;
if (!host || !password) { console.error("خطأ: DEVICE_IP و DEVICE_PASSWORD لازم يكونوا بملف .env"); process.exit(1); }

const days = Number(process.argv[2] || 400);
const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

(async () => {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  console.log(`بسحب السجل من الجهاز ${host} (آخر ${days} يوم)...`);
  const users = await listDeviceUsers({ host, port, username, password }).catch(() => []);
  const nameOf = new Map((users || []).map((u) => [String(u.employeeNo || u.employeeNoString || ""), u.name || ""]));
  const events = await searchAllAcsEvents({ host, port, username, password, startTime: start, endTime: end });
  const rows = events
    .filter((e) => e.employeeNoString || e.employeeNo)
    .map((e) => {
      const no = String(e.employeeNoString || e.employeeNo);
      const t = new Date(e.time);
      return { no, name: e.name || nameOf.get(no) || "", t };
    })
    .sort((a, b) => a.t - b.t);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const lines = ["رقم البصمة,الاسم,التاريخ,الوقت"];
  for (const r of rows) {
    const p = Object.fromEntries(fmt.formatToParts(r.t).map((x) => [x.type, x.value]));
    lines.push([q(r.no), q(r.name), `${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}:${p.second}`].join(","));
  }
  const out = path.join(process.env.USERPROFILE || __dirname, "Desktop", `device-punches-${new Date().toISOString().slice(0, 10)}.csv`);
  const target = fs.existsSync(path.dirname(out)) ? out : path.join(__dirname, path.basename(out));
  fs.writeFileSync(target, "﻿" + lines.join("\n"), "utf8");
  console.log(`تم: ${rows.length} بصمة -> ${target}`);
})().catch((e) => { console.error("فشل السحب:", e.message); process.exit(1); });
