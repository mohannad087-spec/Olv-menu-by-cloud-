// استقبال بصمات الحضور مباشرة من جهاز Hikvision (HTTP Listening) بدون كمبيوتر وسيط.
// الجهاز بيرسل كل حدث وقت حصوله (JSON أو multipart فيه جزء JSON). ما بيقدر يحط
// header خاص فالرمز بيجي بالرابط (?t=...) وبنتحقق من بصمته (SHA-256) بجدول
// attendance_bridge_tokens، نفس رمز الجسر. verify_jwt مطفي لهالسبب.
// الحدث بيحمل رقم الموظف + اسمه، فبنربط بالاسم تلقائيًا لو الموظف ما إله رقم.
import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFKC").replace(/[ً-ٰٟ]/g, "").replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();

// اسم الجهاز يطابق اسم الموظف لو كل كلماته موجودة باسم الموظف (مثال: "ahmad" ضمن "ahmad shaheer")
function nameMatches(dev: string, full: string): boolean {
  if (!dev || !full) return false;
  if (dev === full) return true;
  const toks = new Set(full.split(" "));
  return dev.split(" ").every((w) => toks.has(w));
}

// يطلّع كائن الحدث من جسم JSON عادي أو من multipart (الجهاز بيبعث event_log كجزء نصي)
async function readEvent(req: Request): Promise<Record<string, unknown> | null> {
  const ct = req.headers.get("content-type") || "";
  const raw = new TextDecoder().decode(new Uint8Array(await req.arrayBuffer()));
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  if (!ct.includes("multipart")) return tryParse(raw);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  // الصورة (إن وُجدت) بتجي بجزء ثاني، فنحاول أول JSON متوازن
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}" && --depth === 0) return tryParse(raw.slice(start, i + 1));
  }
  return end > start ? tryParse(raw.slice(start, end + 1)) : null;
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "config" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const token = new URL(req.url).searchParams.get("t") || "";
  if (token.length < 20) return json({ ok: false, error: "bad token" }, 401);
  const { data: tok } = await admin
    .from("attendance_bridge_tokens").select("id, revoked").eq("token_sha256", await sha256(token)).maybeSingle();
  if (!tok || tok.revoked) return json({ ok: false, error: "bad token" }, 401);
  await admin.from("attendance_bridge_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);

  if (req.method !== "POST") return json({ ok: true });
  const ev = await readEvent(req);
  const ace = (ev?.AccessControllerEvent ?? {}) as Record<string, unknown>;
  const no = String(ace.employeeNoString ?? "").trim();
  const t = new Date(String(ev?.dateTime ?? ""));
  // نبضة/حدث نظام بدون موظف: نرد OK وما نسوي شي
  if (!ev || !no || isNaN(t.getTime())) return json({ ok: true, ignored: true });
  if (t.getTime() > Date.now() + 10 * 60 * 1000) return json({ ok: true, ignored: "future" });

  let { data: prof } = await admin.from("profiles").select("id").eq("device_user_id", no).maybeSingle();
  if (!prof && ace.name) {
    const n = norm(ace.name);
    const { data: all } = await admin.from("profiles").select("id, full_name").is("device_user_id", null);
    const hits = (all || []).filter((p) => nameMatches(n, norm(p.full_name)));
    if (n && hits.length === 1) {
      const { error } = await admin.from("profiles").update({ device_user_id: no }).eq("id", hits[0].id);
      if (!error) prof = { id: hits[0].id };
    }
  }
  if (!prof) return json({ ok: true, unmapped: no });

  const { error } = await admin.from("employee_punches")
    .upsert([{ profile_id: prof.id, punched_at: t.toISOString(), source: "fingerprint" }],
      { onConflict: "profile_id,punched_at", ignoreDuplicates: true });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, saved: 1 });
});
