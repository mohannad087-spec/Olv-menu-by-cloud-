// بحث بالكلمات للقوائم الطويلة (مخزون، مستلزمات، جرد...): كل كلمة لازم تكون موجودة بالنص بأي ترتيب،
// فـ"معس بطيخ" بتلاقي "معسل مزايا بطيخ". بيتجاهل التشكيل والهمزات والتاء المربوطة والياء/الألف المقصورة و"ال" التعريف.
//   olvSearchMatch(text, query) → boolean (استعلام فاضي = يطابق كل شي)
//   olvSearchNorm(text)         → النص موحّد الحروف
(function () {
  const norm = (s) => String(s || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = (q) => norm(q).split(" ").filter(Boolean).map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t));
  window.olvSearchNorm = norm;
  window.olvSearchMatch = (text, q) => {
    const t = tokens(q);
    if (!t.length) return true;
    const h = norm(text);
    return t.every((w) => h.includes(w));
  };
})();
