// استقبال بصمات الحضور من جسر البصمة (attendance-bridge) على كمبيوتر المحل.
// الجسر ما بيحمل مفتاح service_role؛ بيرسل رمز خاص (x-bridge-token) بصمته
// (SHA-256) محفوظة بجدول attendance_bridge_tokens. الدالة بتتحقق من الرمز
// وبتطابق رقم الموظف على الجهاز مع profiles.device_user_id وبتحفظ البصمات
// بجدول employee_punches (البصمة المكررة بتنتجاهل). verify_jwt مطفي لأن
// التحقق هون برمز الجسر مو بجلسة مستخدم.
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "إعدادات الدالة ناقصة" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const token = req.headers.get("x-bridge-token") || "";
  if (token.length < 20) return json({ ok: false, error: "رمز غير صالح" }, 401);
  const { data: tok } = await admin
    .from("attendance_bridge_tokens").select("id, revoked").eq("token_sha256", await sha256(token)).maybeSingle();
  if (!tok || tok.revoked) return json({ ok: false, error: "رمز غير صالح" }, 401);

  let body: { events?: { employeeNo?: unknown; time?: unknown }[]; users?: { employeeNo?: unknown; name?: unknown }[] };
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON غير صالح" }, 400); }
  const events = Array.isArray(body.events) ? body.events.slice(0, 1000) : [];

  // ربط بالاسم: موظف بالتطبيق بدون device_user_id واسمه مطابق لاسم شخص على الجهاز (مطابقة وحيدة فقط)
  const linked: string[] = [];
  const users = Array.isArray(body.users) ? body.users.slice(0, 500) : [];
  if (users.length) {
    const norm = (s: unknown) => String(s ?? "").normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
    const { data: all } = await admin.from("profiles").select("id, full_name, device_user_id");
    const taken = new Set((all || []).filter((p) => p.device_user_id).map((p) => String(p.device_user_id)));
    const free = (all || []).filter((p) => !p.device_user_id && norm(p.full_name));
    for (const u of users) {
      const no = String(u.employeeNo ?? "").trim();
      const n = norm(u.name);
      if (!no || !n || taken.has(no)) continue;
      const hits = free.filter((p) => norm(p.full_name) === n);
      if (hits.length !== 1) continue;
      const { error } = await admin.from("profiles").update({ device_user_id: no }).eq("id", hits[0].id);
      if (!error) { taken.add(no); linked.push(`${hits[0].full_name} (${no})`); free.splice(free.indexOf(hits[0]), 1); }
    }
  }

  const nos = [...new Set(events.map((e) => String(e.employeeNo ?? "").trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (nos.length) {
    const { data: profs, error } = await admin.from("profiles").select("id, device_user_id").in("device_user_id", nos);
    if (error) return json({ ok: false, error: error.message }, 500);
    for (const p of profs || []) map.set(String(p.device_user_id), p.id);
  }

  const rows: { profile_id: string; punched_at: string; source: string }[] = [];
  const unmapped = new Set<string>();
  const now = Date.now();
  for (const e of events) {
    const no = String(e.employeeNo ?? "").trim();
    const t = new Date(String(e.time ?? ""));
    if (!no || isNaN(t.getTime())) continue;
    // بصمة بالمستقبل البعيد = ساعة جهاز غلط، نرفضها بدل ما تخرّب الدوام
    if (t.getTime() > now + 10 * 60 * 1000) continue;
    const pid = map.get(no);
    if (!pid) { unmapped.add(no); continue; }
    rows.push({ profile_id: pid, punched_at: t.toISOString(), source: "fingerprint" });
  }

  if (rows.length) {
    const { error } = await admin.from("employee_punches")
      .upsert(rows, { onConflict: "profile_id,punched_at", ignoreDuplicates: true });
    if (error) return json({ ok: false, error: error.message }, 500);
  }
  await admin.from("attendance_bridge_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);
  return json({ ok: true, received: events.length, saved: rows.length, unmapped: [...unmapped], linked });
});
