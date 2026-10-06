// مطابقة أسماء المواد بالعربي (مشتركة بين parse-order و ai-assist).
// النموذج بيرجّع اسم المادة كما هو بالقائمة، وهون بنلاقيها بأسماء المخزون الفعلية:
// الاسم المطابق حرفيًا أولًا، وإلا الأقرب بالكلمات (بيتسامح بالهمزات والتاء المربوطة و"ال"
// والأخطاء البسيطة). وبنقارن كمان مع النص الأصلي، فإذا النموذج اختار مادة قريبة بالغلط
// (مثلًا «معسل مزايا علكة» بدل «معسل مزايا علكة نعناع») بنصحّحها، وإذا في التباس بنعلّم
// السطر «غير أكيد» حتى يتأكد منه المستخدم.

export function norm(s: string): string {
  return String(s || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

// كلمات ما بتميّز المادة (وحدات وكميات وحروف جر)
const STOP = new Set([
  "من", "مع", "و", "او", "في", "على", "عدد", "حبه", "حبات", "قطعه", "قطع", "كيلو", "كيلوغرام", "كغ", "كغم", "كجم", "غرام", "جرام", "غ",
  "لتر", "ليتر", "مل", "كرتونه", "كراتين", "كرتون", "علبه", "علب", "صندوق", "صناديق", "كيس", "اكياس", "باكيت", "باكو", "ربطه", "حزمه",
  "شوال", "جالون", "نص", "نصف", "ربع", "kg", "g", "l", "ml", "x",
]);

export function tokens(s: string): string[] {
  return norm(s).split(" ")
    .map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t))
    .map((t) => (t.length > 3 && t.startsWith("وال") ? t.slice(3) : t))
    .filter((t) => t && !STOP.has(t) && !/^\d+([.]\d+)?$/.test(t));
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= 2) return true; // معس ↔ معسل، تفاح ↔ تفاحه
  if (short.length >= 4) return editDistance(a, b, 1) <= 1; // خطأ إملائي بحرف
  return false;
}

// تشابه بين نص واسم مادة (0..1): كم كلمة من الاسم موجودة بالنص، وكم كلمة من النص موجودة بالاسم
export function similarity(text: string, name: string): number {
  const q = tokens(text), n = tokens(name);
  if (!q.length || !n.length) return 0;
  const nHit = n.filter((w) => q.some((x) => sameWord(w, x))).length;
  const qHit = q.filter((w) => n.some((x) => sameWord(w, x))).length;
  if (!nHit || !qHit) return 0;
  const r = nHit / n.length, p = qHit / q.length;
  return (2 * p * r) / (p + r);
}

export type Named = { name: string };

function ranked<T extends Named>(text: string, list: T[]): { item: T; score: number }[] {
  return list
    .map((item) => ({ item, score: similarity(text, item.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

// بيلاقي المادة لسطر: picked = الاسم اللي رجّعه النموذج (ممكن يكون فاضي)، raw = النص الأصلي للسطر
export function resolveItem<T extends Named>(picked: string | null | undefined, raw: string, list: T[]): { item: T | null; sure: boolean } {
  const byName = new Map<string, T>();
  list.forEach((it) => { const k = norm(it.name); if (!byName.has(k)) byName.set(k, it); });

  let cand: T | null = null;
  let exact = false;
  if (picked) {
    cand = byName.get(norm(picked)) || null;
    exact = !!cand;
    if (!cand) {
      const r = ranked(picked, list);
      if (r.length && r[0].score >= 0.75 && (r.length < 2 || r[0].score - r[1].score >= 0.1)) cand = r[0].item;
    }
  }

  const fromRaw = ranked(raw, list);
  const best = fromRaw[0];
  const second = fromRaw[1];
  const clearBest = best && best.score >= 0.75 && (!second || second.score < best.score - 0.05);

  if (!cand) {
    // النموذج ما لقى شي: منقبل بس تطابق شبه كامل وواضح من النص نفسه، وبنعلّمه غير أكيد
    if (best && best.score >= 0.85 && (!second || best.score - second.score >= 0.15)) return { item: best.item, sure: false };
    if (best && best.score >= 0.5 && !second) return { item: best.item, sure: false }; // مادة وحيدة فيها كلمات من السطر
    return { item: null, sure: false };
  }

  const candRaw = similarity(raw, cand.name);
  // النص بيطابق مادة ثانية بوضوح أكثر من اللي اختارها النموذج: النص أصدق
  if (clearBest && best.item !== cand && candRaw <= best.score - 0.15) return { item: best.item, sure: best.score >= 0.99 };
  // التباس: النص بيطابق أكثر من مادة بنفس الدرجة تقريبًا
  const ambiguous = fromRaw.filter((x) => x.score >= candRaw - 0.05 && x.item !== cand).length > 0 && candRaw < 0.99;
  return { item: cand, sure: exact && candRaw >= 0.5 && !ambiguous };
}
