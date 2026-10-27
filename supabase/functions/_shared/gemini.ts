// استدعاء Gemini المشترك بين كل دوال الذكاء الاصطناعي (قراءة الفواتير، تجهيز الطلبيات،
// الإضافة بالذكاء، اقتراح الوصفات).
//
// ليش موجود: قبل كان كل طلب لجوجل بلا مهلة. لما الخدمة المجانية تعلق أو "تفكّر" كتير على
// صورة، الدالة كانت تضل تستنى لحد ما Supabase يقتلها (~150 ثانية) والمستخدم يضل يشوف
// "عم يقرأ..." وبالآخر ما يطلع شي. هون:
//   - كل محاولة إلها مهلة، وكل الطلب إله سقف وقت إجمالي أقل من حد Supabase، فدايمًا في رد.
//   - "التفكير" محدود (الموديلات الجديدة بتفكّر قبل ما تجاوب وهاد بيطوّل كتير على مهمة نقل
//     أرقام من صورة). إذا موديل رفض الإعداد، منعيد بدونه.
//   - إذا الموديل الأساسي علق أو انضغط أو وصل حده، منجرّب الموديل الأخف بالوقت الباقي.
//   - منسجّل بالـlogs اسم الموديل والمدة والنتيجة (بدون أي بيانات من الصورة أو النص).

export type GeminiResult =
  | { ok: true; text: string; model: string }
  | { ok: false; status: number; message: string; timedOut: boolean };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// عدّاد الاستهلاك (جدول ai_usage، schema-ai-usage.sql): كل محاولة لجوجل بتنسجّل (الدالة، الموديل، الحالة، التوكنز)
// حتى «المساعد الذكي» يعرض قديش انصرف اليوم وقديش تقريبًا ضايل. جوجل ما بتعطي الرصيد الباقي، فهاد عدّنا إحنا.
// ما بيوقّف شي إذا فشل (الجدول مش موجود مثلًا).
export async function logUsage(row: { tag: string; model: string; status: number; usage?: any; ms?: number }) {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  const u = row.usage || {};
  try {
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/ai_usage`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({
        fn: row.tag.slice(0, 40), model: row.model.slice(0, 60), status: row.status, ms: row.ms ?? null,
        prompt_tokens: Number(u.promptTokenCount) || 0, output_tokens: Number(u.candidatesTokenCount) || 0,
        thought_tokens: Number(u.thoughtsTokenCount) || 0, total_tokens: Number(u.totalTokenCount) || 0,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (_) { /* العدّاد مش أساسي */ }
}

export async function callGemini(
  apiKey: string,
  parts: unknown[],
  generationConfig: Record<string, unknown>,
  opts: { tag: string; totalMs?: number; perCallMs?: number },
): Promise<GeminiResult> {
  const primary = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
  const models = [...new Set([primary, "gemini-flash-lite-latest"])];
  const totalMs = opts.totalMs ?? 110_000;
  const perCallMs = opts.perCallMs ?? 60_000;
  const deadline = Date.now() + totalMs;
  let lastStatus = 0;
  let lastMsg = "";
  let timedOut = false;

  for (const model of models) {
    let withThinkingCap = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) break;
      const started = Date.now();
      const config = withThinkingCap ? { ...generationConfig, thinkingConfig: { thinkingBudget: 512 } } : generationConfig;
      let r: Response;
      let out: any;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: config }),
          signal: AbortSignal.timeout(Math.min(perCallMs, remaining)),
        });
        out = await r.json().catch(() => ({}));
      } catch (e) {
        const isTimeout = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
        console.log(JSON.stringify({ tag: opts.tag, model, attempt, ms: Date.now() - started, error: isTimeout ? "timeout" : String((e as Error)?.message || e) }));
        lastStatus = 504;
        lastMsg = isTimeout ? "timeout" : String((e as Error)?.message || e);
        await logUsage({ tag: opts.tag, model, status: 504, ms: Date.now() - started });
        if (isTimeout) { timedOut = true; break; } // علق — ما في وقت نعيد عليه، منروح للموديل الأخف
        continue;
      }
      const cand = out?.candidates?.[0];
      console.log(JSON.stringify({
        tag: opts.tag, model, attempt, ms: Date.now() - started, status: r.status,
        finish: cand?.finishReason, usage: out?.usageMetadata, err: r.ok ? undefined : out?.error?.message?.slice(0, 200),
      }));
      await logUsage({ tag: opts.tag, model, status: r.status, usage: out?.usageMetadata, ms: Date.now() - started });
      if (r.ok) {
        // النص ممكن يجي مقسوم على أكتر من جزء، وأجزاء "التفكير" منتجاهلها
        const text = (cand?.content?.parts || []).filter((p: any) => !p?.thought && typeof p?.text === "string").map((p: any) => p.text).join("");
        if (text) return { ok: true, text, model };
        lastStatus = 422;
        lastMsg = cand?.finishReason ? `finish: ${cand.finishReason}` : "empty";
        break; // رد فاضي — منجرّب الموديل التاني
      }
      lastStatus = r.status;
      lastMsg = out?.error?.message || `خطأ من Gemini (${r.status})`;
      if (r.status === 400 && withThinkingCap && /think/i.test(lastMsg)) { withThinkingCap = false; attempt--; continue; }
      if (r.status === 429) break; // حد هالموديل — نجرّب الموديل التاني مباشرة
      if ([500, 502, 503, 504].includes(r.status)) { if (attempt === 0) await sleep(1500); continue; }
      return { ok: false, status: r.status, message: lastMsg, timedOut: false }; // خطأ غير مؤقت (طلب مرفوض...)
    }
  }
  return { ok: false, status: lastStatus || 504, message: lastMsg, timedOut };
}
