// «سيرفر المحل» (مجلد local-server/ على كمبيوتر الكاشير): لما الصفحة مفتوحة منه
// (window.OLV_LOCAL بيحطها هو بكل صفحة)، الكاشير بيبعتله الطلبات وقت انقطاع النت،
// وشاشات المطبخ بتقرأ منه. لما الصفحة مفتوحة من الرابط العادي، ولا شي من هاد بيشتغل.
(function () {
  const enabled = !!window.OLV_LOCAL;

  async function call(method, route, body) {
    if (!enabled) throw new Error("مش مفتوح من كمبيوتر المحل");
    const res = await fetch("/_local/" + route, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "كمبيوتر المحل ما ردّ");
    return data;
  }

  window.OlvLocal = {
    enabled,
    get: (route) => call("GET", route),
    post: (route, body) => call("POST", route, body),
  };
})();
