// «سيرفر المحل»: برنامج صغير على كمبيوتر الكاشير، بيخلي الطلب يوصل من الكاشير لشاشات
// المطبخ والبارات حتى لو النت مقطوع. بيعمل شغلتين:
//  1) بيفتح صفحات البرنامج على شبكة المحل (http://<عنوان الكمبيوتر>:8080). وقت النت شغّال
//     بيجيبها من الموقع الأصلي (GitHub Pages) وبيحفظ نسخة، ووقت الانقطاع بيعطي المحفوظ —
//     هيك التحديثات بتوصل لحالها وما في شي تنزّله بإيدك.
//  2) بيحفظ نسخة من طلبات المطبخ (راجع store.js) حتى تقرأها الشاشات وقت الانقطاع.
// ما معه أي مفتاح لقاعدة البيانات: الرفع للسحابة بتعمله الصفحات نفسها لما يرجع النت.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createStore } = require("./store");

const ROOT = path.join(__dirname, "..");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch (_) { /* الافتراضي */ }
const PORT = Number(process.env.PORT || cfg.port || 8080);
const SITE = String(process.env.OLV_SITE || cfg.site || "https://mohannad087-spec.github.io/olv-menu-by-cloud-/").replace(/\/?$/, "/");
const DATA = path.join(ROOT, "data");
const CACHE = path.join(DATA, "site-cache");
fs.mkdirSync(CACHE, { recursive: true });

// مفتاح الربط: كل جهاز بالمحل بيفتح رابط الربط مرة وحدة وبينحفظ عنده (كوكي)،
// حتى ما يقدر أي حدا على واي فاي المحل يقرأ الطلبات أو يبعت طلبات وهمية
const KEY_FILE = path.join(DATA, "pair-key.txt");
let PAIR_KEY;
try { PAIR_KEY = fs.readFileSync(KEY_FILE, "utf8").trim(); } catch (_) { /* أول تشغيل */ }
if (!PAIR_KEY) { PAIR_KEY = crypto.randomBytes(6).toString("hex"); fs.writeFileSync(KEY_FILE, PAIR_KEY); }

const store = createStore(DATA);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8",
};
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";

// ---------- الصفحات: من الموقع الأصلي، وإذا النت مقطوع من النسخة المحفوظة ----------
let upstreamDownUntil = 0; // بعد فشل، منروح للمحفوظ فورًا لمدة 20 ثانية بدل ما نستنى كل مرة
let lastOnlineAt = 0;

function cacheFile(rel) {
  const clean = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(CACHE, clean.endsWith("/") || clean === "" ? clean + "index.html" : clean);
}

async function fetchUpstream(rel) {
  if (Date.now() < upstreamDownUntil) return null;
  try {
    const res = await fetch(SITE + rel, { signal: AbortSignal.timeout(4000), headers: { "cache-control": "no-cache" } });
    lastOnlineAt = Date.now();
    if (res.status === 404) return { status: 404 };
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    const file = cacheFile(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", body);
    fs.renameSync(file + ".tmp", file);
    return { status: 200, body };
  } catch (_) {
    upstreamDownUntil = Date.now() + 20000;
    return null;
  }
}

function readCached(rel) {
  try { return fs.readFileSync(cacheFile(rel)); } catch (_) { return null; }
}

let SUPABASE_JS = path.join(ROOT, "node_modules/@supabase/supabase-js/dist/umd/supabase.js");
try { SUPABASE_JS = require.resolve("@supabase/supabase-js/dist/umd/supabase.js"); } catch (_) { /* المسار المباشر */ }

// كل صفحة بتعرف إنها مفتوحة من كمبيوتر المحل، ومكتبة Supabase بتيجي من هون مش من النت
// وإذا النت مقطوع هلق منقلّها (OLV_LOCAL_OFFLINE) حتى ما تعلّق بمحاولة تجديد تسجيل الدخول
function patchHtml(buf, offline) {
  return Buffer.from(String(buf)
    .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2[^"']*/g, "/_local/supabase.js")
    .replace(/<head>/i, `<head><script>window.OLV_LOCAL=true;${offline ? "window.OLV_LOCAL_OFFLINE=true;" : ""}</script>`));
}

async function serveSite(req, res, rel) {
  let got = await fetchUpstream(rel);
  let body = got && got.status === 200 ? got.body : null;
  if (!body) body = readCached(rel);
  if (!body && rel.endsWith(".html") === false && !path.extname(rel)) {
    rel = rel.replace(/\/?$/, "/") + "index.html";
    got = await fetchUpstream(rel);
    body = (got && got.body) || readCached(rel);
  }
  if (!body) {
    res.writeHead(got && got.status === 404 ? 404 : 503, { "content-type": "text/html; charset=utf-8" });
    res.end(`<meta charset="utf-8"><div dir="rtl" style="font-family:sans-serif;padding:24px">${got && got.status === 404
      ? "الصفحة مش موجودة."
      : "هالصفحة لسا ما انحفظت على كمبيوتر المحل، وما في نت. افتحها مرة والنت شغّال."}</div>`);
    return;
  }
  if (rel.endsWith(".html")) body = patchHtml(body, !(got && got.status === 200));
  // no-cache: المتصفح بيسأل كل مرة، فالتحديثات بتوصل فورًا (والسيرفر قريب فما في بطء)
  res.writeHead(200, { "content-type": typeOf(rel), "cache-control": "no-cache" });
  res.end(body);
}

// تحضير مسبق: منحفظ الصفحات المهمة وكل ملفاتها، حتى لو ما حدا فتحها قبل الانقطاع
const WARM_PAGES = ["accounting/login.html", "accounting/index.html", "accounting/pos.html", "accounting/kitchen.html",
  "accounting/sales.html", "accounting/tables.html", "accounting/incoming-orders.html", "accounting/cash-register.html",
  "accounting/manifest.webmanifest", "accounting/sw.js"];
async function warmCache() {
  if (Date.now() < upstreamDownUntil) return;
  const seen = new Set();
  const queue = [...WARM_PAGES];
  while (queue.length && seen.size < 400) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const got = await fetchUpstream(rel);
    if (!got || got.status !== 200) { if (Date.now() < upstreamDownUntil) return; continue; }
    if (!/\.(html|css|webmanifest)$/.test(rel)) continue;
    const text = String(got.body);
    const refs = [...text.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g), ...text.matchAll(/url\(["']?([^"')#?]+)["']?\)/g)]
      .map((m) => m[1]).filter((u) => !/^(https?:|data:|mailto:|tel:|\/\/|javascript:)/i.test(u));
    for (const u of refs) {
      const abs = new URL(u, "http://x/" + rel).pathname.replace(/^\//, "");
      if (abs.startsWith("accounting/") && path.extname(abs)) queue.push(abs);
    }
  }
  console.log(`[${new Date().toLocaleTimeString()}] انحفظت ${seen.size} ملف من البرنامج على هالكمبيوتر`);
}

// ---------- واجهة المطبخ المحلية /_local/... ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 1e6) { reject(new Error("كبير كتير")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function paired(req) {
  const m = /(?:^|;\s*)olv_local=([^;]+)/.exec(req.headers.cookie || "");
  return !!m && m[1] === PAIR_KEY;
}

async function handleLocal(req, res, url) {
  const route = url.pathname.slice("/_local/".length);
  if (route === "supabase.js") {
    res.writeHead(200, { "content-type": typeOf(".js"), "cache-control": "max-age=86400" });
    fs.createReadStream(SUPABASE_JS).pipe(res);
    return;
  }
  if (route === "pair") {
    if (url.searchParams.get("k") !== PAIR_KEY) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end('<meta charset="utf-8"><div dir="rtl" style="font-family:sans-serif;padding:24px">رابط الربط غلط. انسخه متل ما هو من شاشة البرنامج على كمبيوتر الكاشير.</div>');
      return;
    }
    res.writeHead(302, {
      "set-cookie": `olv_local=${PAIR_KEY}; Path=/; Max-Age=315360000; SameSite=Strict; HttpOnly`,
      location: "/accounting/login.html",
    });
    res.end();
    return;
  }
  if (route === "ping") return json(res, 200, { ok: true, paired: paired(req), online: Date.now() - lastOnlineAt < 60000 });
  if (!paired(req)) return json(res, 401, { error: "هالجهاز مش مربوط بكمبيوتر المحل. افتح رابط الربط مرة وحدة." });

  if (req.method === "GET" && route === "kitchen") return json(res, 200, store.kitchenView());
  if (req.method === "GET" && route === "dirty") return json(res, 200, { orders: store.dirtyList() });
  if (req.method !== "POST") return json(res, 404, { error: "مش موجود" });
  const body = await readBody(req);
  if (route === "orders") {
    const o = store.addLocalOrder(body);
    console.log(`[${new Date().toLocaleTimeString()}] طلب بدون نت ${o.order_no} (${o.items.length} صنف) وصل للمطبخ`);
    return json(res, 200, { ok: true, order_no: o.order_no });
  }
  if (route === "done") { store.setDone(body.order_id, body.item_ids, !!body.done); return json(res, 200, { ok: true }); }
  if (route === "snapshot") { store.applySnapshot(body.orders); return json(res, 200, { ok: true }); }
  if (route === "synced") { store.markSynced(body.order_id, body.synced, !!body.uploaded); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: "مش موجود" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (url.pathname.startsWith("/_local/")) return await handleLocal(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    if (url.pathname === "/" || url.pathname === "/accounting" || url.pathname === "/accounting/") {
      res.writeHead(302, { location: "/accounting/index.html" });
      res.end();
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (rel.split("/").some((seg) => seg === ".." || seg.startsWith("."))) { res.writeHead(404); res.end(); return; }
    await serveSite(req, res, rel);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 400, { error: String(err.message || err) });
    else res.end();
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
}

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanAddresses();
  const ip = ips[0] || "localhost";
  console.log("");
  console.log("  ✅ سيرفر المحل شغّال — خلّي هالشباك مفتوح (بتقدر تصغّره)");
  console.log("");
  console.log("  على كل جهاز بالمحل (الكاشير، تابلت المطبخ، البارات) افتح Chrome على هالرابط مرة وحدة:");
  ips.forEach((a) => console.log(`     http://${a}:${PORT}/_local/pair?k=${PAIR_KEY}`));
  if (!ips.length) console.log(`     http://localhost:${PORT}/_local/pair?k=${PAIR_KEY}`);
  console.log("");
  console.log(`  وبعدها البرنامج دايمًا على: http://${ip}:${PORT}`);
  console.log("");
  warmCache().catch(() => {});
  setInterval(() => warmCache().catch(() => {}), 20 * 60 * 1000);
  setInterval(() => store.prune(), 10 * 60 * 1000);
});

process.on("SIGINT", () => { store.flush(); process.exit(0); });
process.on("SIGTERM", () => { store.flush(); process.exit(0); });
