/*!
 * نسخ JavaScript عادية (بدون React) من مكوّنات React Bits — https://github.com/DavidHDev/react-bits
 * التطبيق ما فيه React ولا خطوة بناء، فنقلنا منطق كل مكوّن كما هو لدوال بتشتغل على عناصر HTML موجودة.
 *
 * Copyright (c) 2026 David Haz — MIT + Commons Clause License Condition v1.0
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, and distribute the Software as part of
 * an application, website, or product, subject to the following conditions: The above copyright notice and
 * this permission notice shall be included in all copies or substantial portions of the Software.
 * Commons Clause: the components themselves may not be sold, sublicensed or redistributed on their own.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * المكوّنات:
 *   OLVBits.aurora(container, opts)    ← Backgrounds/Aurora (نفس الـshader حرفيًا، WebGL2 بدون ogl)
 *   OLVBits.splitText(el, opts)        ← TextAnimations/SplitText (GSAP SplitText + ScrollTrigger)
 *   OLVBits.blurText(el, opts)         ← TextAnimations/BlurText (نفس الـkeyframes، بـGSAP بدل motion)
 *   OLVBits.shinyText(el, opts)        ← TextAnimations/ShinyText (لمعة بتمشي على النص، نسخة مختصرة)
 *   OLVBits.starBorder(el, opts)       ← Animations/StarBorder (نجمة بتلف على حواف الزر + نبضة عند الضغط)
 *   OLVBits.clickSpark(opts)           ← Animations/ClickSpark (شرارات عند الضغط، canvas واحد للصفحة)
 * كل دالة بترجع دالة تنظيف، وكلها بتحترم «تقليل الحركة» بإعدادات الجهاز.
 */
(function () {
  'use strict';

  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const TAU = Math.PI * 2;

  /* ---------- لون CSS → [r,g,b] (0..255) ---------- */
  let probe = null;
  const toRgb = color => {
    probe = probe || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe) return [255, 255, 255];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#ffffff';
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  /* =====================================================================
   * Aurora — خلفية شفق متحرك (WebGL2)
   * ===================================================================== */
  const MAX_STOPS = 5;
  const MAX_LAYERS = 3;
  const INTRO_SECONDS = 2.4;

  const AURORA_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const AURORA_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
uniform float uLightMode;
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${MAX_LAYERS}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);

    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);
    cover *= smootherstep(0.0, 0.25, cover);
    float alpha = cover * 0.7;
    outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));
    return;
  }
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`;

  const toOklch = rgb => {
    const [r, g, b] = rgb.map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lab = [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
    return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
  };

  const unwrapHues = stops => {
    const known = stops.findIndex(stop => stop[1] > 0.02);
    const anchor = known === -1 ? 0 : stops[known][2];
    let previous = anchor;
    return stops.map(stop => {
      let hue = stop[1] > 0.02 ? stop[2] : previous;
      while (hue - previous > Math.PI) hue -= TAU;
      while (hue - previous < -Math.PI) hue += TAU;
      previous = hue;
      return [stop[0], stop[1], hue];
    });
  };

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  const link = gl => {
    const vertex = compile(gl, gl.VERTEX_SHADER, AURORA_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, AURORA_FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  };

  function aurora(container, opts) {
    const o = Object.assign({
      colorStops: ['#5227FF', '#7cff67', '#5227FF'],
      amplitude: 1, blend: 0.5, speed: 1, height: 0.45, scale: 1, glow: 0.6, brightness: 1,
      layers: 1, direction: 'top', mouseInteraction: true, intro: true, opacity: 1, lightMode: false, dpr: undefined
    }, opts || {});
    const stops = o.colorStops.filter(Boolean).map(String).slice(0, MAX_STOPS);
    const s = {
      stops: stops.length >= 2 ? stops : [stops[0] || '#5227FF', stops[0] || '#7cff67'],
      amplitude: Math.max(0, o.amplitude), blend: clamp(o.blend, 0, 1), speed: o.speed,
      height: clamp(o.height, 0, 1), scale: Math.max(0.1, o.scale), glow: Math.max(0, o.glow),
      brightness: Math.max(0, o.brightness), layers: clamp(Math.round(o.layers), 1, MAX_LAYERS),
      flip: o.direction === 'bottom' ? 1 : 0, mouseInteraction: o.mouseInteraction, intro: o.intro,
      opacity: clamp(o.opacity, 0, 1), lightMode: o.lightMode, dpr: o.dpr
    };

    const canvas = document.createElement('canvas');
    canvas.className = 'aurora-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.classList.add('aurora-container');
    container.prepend(canvas);

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    const program = gl && link(gl);
    if (!gl || !program) { canvas.remove(); return () => {}; }
    const u = program.uniforms;

    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const reduce = reduced();
    // الألوان ثابتة، فنحسبها مرة وحدة بدل كل إطار
    const palette = new Float32Array(MAX_STOPS * 3);
    unwrapHues(s.stops.map(v => toOklch(toRgb(v).map(c => c / 255)))).forEach((stop, i) => palette.set(stop, i * 3));

    const view = { width: 1, height: 1 };
    const pointer = { x: 0, y: 0, inside: false };
    const state = { clock: 0, px: 0, py: 0.5, reach: 0, reveal: s.intro && !reduce ? 0 : 1 };
    let raf = 0;
    let last = 0;
    let visible = true;

    const render = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program.program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, state.clock);
      gl.uniform3fv(u.uStops, palette);
      gl.uniform1i(u.uStopCount, s.stops.length);
      gl.uniform1f(u.uAmplitude, s.amplitude);
      gl.uniform1f(u.uBlend, s.blend);
      gl.uniform1f(u.uHeight, s.height);
      gl.uniform1f(u.uScale, s.scale);
      gl.uniform1f(u.uGlow, s.glow);
      gl.uniform1f(u.uBrightness, s.brightness);
      gl.uniform1i(u.uLayers, s.layers);
      gl.uniform1f(u.uFlip, s.flip);
      gl.uniform3f(u.uPointer, state.px, state.py, state.reach);
      gl.uniform1f(u.uReveal, 1 - Math.pow(1 - state.reveal, 3));
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.uniform1f(u.uLightMode, s.lightMode ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = now => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
      last = now;
      if (reduce) { state.reveal = 1; render(); return; } // إطار واحد ثابت
      state.clock += dt * s.speed;
      const engaged = s.mouseInteraction && pointer.inside;
      const follow = 1 - Math.exp(-dt / 0.6);
      if (engaged) {
        const tx = (pointer.x - view.width / 2) / view.height;
        const ty = s.flip ? 1 - pointer.y / view.height : pointer.y / view.height;
        state.px += (tx - state.px) * follow;
        state.py += (ty - state.py) * follow;
      }
      state.reach += ((engaged ? 1 : 0) - state.reach) * (1 - Math.exp(-dt / (engaged ? 0.9 : 1.4)));
      if (!s.intro) state.reveal = 1;
      else if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);
      render();
      raf = requestAnimationFrame(frame);
    };

    const wake = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const ratio = Math.min(s.dpr || window.devicePixelRatio || 1, 2);
      view.width = width;
      view.height = height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      render();
      wake();
    };

    const onPointerMove = e => {
      const rect = container.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      const wasInside = pointer.inside;
      pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
      if (pointer.inside && !wasInside) {
        state.px = (pointer.x - rect.width / 2) / Math.max(1, rect.height);
        state.py = s.flip ? 1 - pointer.y / Math.max(1, rect.height) : pointer.y / Math.max(1, rect.height);
      }
      wake();
    };
    const onPointerUp = e => { if (e.pointerType !== 'mouse') pointer.inside = false; };
    const onPointerLeave = () => { pointer.inside = false; };
    const onVisibility = () => { last = 0; wake(); };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const io = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
      if (visible) { last = 0; wake(); }
    });
    io.observe(container);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteProgram(program.program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      canvas.remove();
    };
  }

  /* =====================================================================
   * SplitText — النص بيطلع حرف حرف (أو كلمة كلمة) لما يوصله السكرول
   * ملاحظة للعربي: تقسيم الحروف بيقطع وصل الحروف، فبالعربي استعمل splitType:'words'.
   * ===================================================================== */
  function splitText(el, opts) {
    const g = window.gsap;
    if (!g || !window.SplitText || !window.ScrollTrigger || !el) return () => {};
    const o = Object.assign({
      delay: 50, duration: 1.25, ease: 'power3.out', splitType: 'chars',
      from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 }, threshold: 0.1, rootMargin: '-100px'
    }, opts || {});
    if (reduced()) return () => {};

    const startPct = (1 - o.threshold) * 100;
    const mm = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(o.rootMargin);
    const mv = mm ? parseFloat(mm[1]) : 0;
    const mu = mm ? mm[2] || 'px' : 'px';
    const sign = mv === 0 ? '' : mv < 0 ? `-=${Math.abs(mv)}${mu}` : `+=${mv}${mu}`;
    const start = `top ${startPct}%${sign}`;

    let split = null;
    const run = () => {
      split = new window.SplitText(el, {
        type: o.splitType,
        smartWrap: true,
        autoSplit: o.splitType === 'lines',
        linesClass: 'split-line',
        wordsClass: 'split-word',
        charsClass: 'split-char',
        reduceWhiteSpace: false,
        onSplit: self => {
          let targets;
          if (o.splitType.includes('chars') && self.chars.length) targets = self.chars;
          if (!targets && o.splitType.includes('words') && self.words.length) targets = self.words;
          if (!targets && o.splitType.includes('lines') && self.lines.length) targets = self.lines;
          if (!targets) targets = self.chars || self.words || self.lines;
          return g.fromTo(targets, Object.assign({}, o.from), Object.assign({}, o.to, {
            duration: o.duration,
            ease: o.ease,
            stagger: o.delay / 1000,
            scrollTrigger: { trigger: el, start, once: true, fastScrollEnd: true },
            willChange: 'transform, opacity',
            force3D: true
          }));
        }
      });
    };
    // نستنى الخط يحمل عشان التقسيم يكون على المقاسات الصح (زي الأصل)
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(run); else run();

    return () => {
      window.ScrollTrigger.getAll().forEach(st => { if (st.trigger === el) st.kill(); });
      if (split) try { split.revert(); } catch (_) { /* noop */ }
    };
  }

  /* =====================================================================
   * BlurText — كل كلمة بتنزل من ضباب لوضوح
   * ===================================================================== */
  function blurText(el, opts) {
    const g = window.gsap;
    if (!g || !el) return () => {};
    const o = Object.assign({ delay: 200, animateBy: 'words', direction: 'top', threshold: 0.1, rootMargin: '0px', stepDuration: 0.35 }, opts || {});
    if (reduced()) return () => {};

    const text = el.textContent.trim();
    const parts = o.animateBy === 'words' ? text.split(/\s+/) : Array.from(text);
    const original = el.innerHTML;
    el.textContent = '';
    el.classList.add('blur-text');
    const spans = parts.map((seg, i) => {
      const sp = document.createElement('span');
      sp.className = 'blur-text__seg';
      sp.textContent = seg === ' ' ? ' ' : seg;
      el.appendChild(sp);
      if (o.animateBy === 'words' && i < parts.length - 1) el.appendChild(document.createTextNode(' '));
      return sp;
    });
    const dy = o.direction === 'top' ? 1 : -1;
    g.set(spans, { filter: 'blur(10px)', opacity: 0, y: -50 * dy });

    const play = () => {
      spans.forEach((sp, i) => {
        g.to(sp, {
          keyframes: [
            { filter: 'blur(5px)', opacity: 0.5, y: 5 * dy, duration: o.stepDuration, ease: 'none' },
            { filter: 'blur(0px)', opacity: 1, y: 0, duration: o.stepDuration, ease: 'none' }
          ],
          delay: (i * o.delay) / 1000,
          onComplete: () => { sp.style.filter = ''; sp.style.willChange = 'auto'; }
        });
      });
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { io.disconnect(); play(); }
    }, { threshold: o.threshold, rootMargin: o.rootMargin });
    io.observe(el);

    return () => { io.disconnect(); g.killTweensOf(spans); el.innerHTML = original; el.classList.remove('blur-text'); };
  }

  /* =====================================================================
   * ShinyText — لمعة بتمر على النص كل شوي
   * ===================================================================== */
  function shinyText(el, opts) {
    const g = window.gsap;
    if (!el) return () => {};
    const o = Object.assign({ color: '#b5b5b5', shineColor: '#ffffff', speed: 2, delay: 0, angle: 120, shineWidth: 40 }, opts || {});
    el.classList.add('shiny-text');
    el.style.setProperty('--shiny-base', o.color);
    el.style.setProperty('--shiny-shine', o.shineColor);
    el.style.setProperty('--shiny-angle', o.angle + 'deg');
    el.style.setProperty('--shiny-width', o.shineWidth + '%');
    if (!g || reduced()) { el.style.setProperty('--shiny-pos', '-50%'); return () => el.classList.remove('shiny-text'); }
    // اللمعة بتمشي بنفس اتجاه القراءة (يمين→يسار بالعربي)
    const rtl = getComputedStyle(el).direction === 'rtl';
    const tw = g.fromTo(el, { '--shiny-pos': rtl ? '-50%' : '150%' }, {
      '--shiny-pos': rtl ? '150%' : '-50%', duration: o.speed, ease: 'sine.inOut', repeat: -1, repeatDelay: o.delay
    });
    return () => { tw.kill(); el.classList.remove('shiny-text'); };
  }

  /* =====================================================================
   * StarBorder — نجمة ضو بتلف على حواف الزر، بتسرّع لفة عند المرور، ونبضة عند الضغط
   * (نفس منطق الأصل بدون غبار الـsparkle، لأنه تقيل على الموبايل)
   * ===================================================================== */
  const BLEED = 48;
  const LAP = 0.9;
  const WHITE = [255, 255, 255];
  const wrap = (v, total) => ((v % total) + total) % total;
  const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (rgb, a) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(a, 0, 1).toFixed(3)})`;

  const outline = (width, height, radius) => {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const arc = (Math.PI * r) / 2;
    const across = Math.max(0, width - 2 * r);
    const down = Math.max(0, height - 2 * r);
    const segments = [
      { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
      { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
      { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
      { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
      { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
      { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
      { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
      { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI }
    ];
    return { r, segments, total: Math.max(1, segments.reduce((sum, sg) => sum + sg.length, 0)) };
  };

  const pointAt = (shape, distance, point) => {
    let s = wrap(distance, shape.total);
    for (const sg of shape.segments) {
      if (sg.length > 0 && s <= sg.length) {
        if (sg.angle === null) {
          point.x = sg.x + sg.dx * s;
          point.y = sg.y + sg.dy * s;
          point.nx = sg.dy;
          point.ny = -sg.dx;
        } else {
          const angle = sg.angle + s / shape.r;
          point.nx = Math.cos(angle);
          point.ny = Math.sin(angle);
          point.x = sg.x + point.nx * shape.r;
          point.y = sg.y + point.ny * shape.r;
        }
        return point;
      }
      s -= sg.length;
    }
    return point;
  };

  const project = (shape, px, py) => {
    let best = Infinity;
    let found = 0;
    let offset = 0;
    shape.segments.forEach(sg => {
      if (sg.length > 0) {
        let s, x, y;
        if (sg.angle === null) {
          s = clamp((px - sg.x) * sg.dx + (py - sg.y) * sg.dy, 0, sg.length);
          x = sg.x + sg.dx * s;
          y = sg.y + sg.dy * s;
        } else {
          let angle = wrap(Math.atan2(py - sg.y, px - sg.x) - sg.angle, TAU);
          if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
          s = angle * shape.r;
          x = sg.x + Math.cos(sg.angle + angle) * shape.r;
          y = sg.y + Math.sin(sg.angle + angle) * shape.r;
        }
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < best) { best = d; found = offset + s; }
      }
      offset += sg.length;
    });
    return found;
  };

  function starBorder(root, opts) {
    if (!root) return () => {};
    const o = Object.assign({
      color: '#ffffff', trailColor: undefined, duration: 4, thickness: 1, radius: 12, trailLength: 0.3,
      stars: 1, glow: 0.6, direction: 'clockwise', hover: 'lap', clickPulse: true, light: false, trackColor: 'rgba(255,255,255,.1)'
    }, opts || {});
    const s = {
      light: o.light, duration: Math.max(0.3, o.duration), thickness: Math.max(0.5, o.thickness),
      radius: Math.max(0, o.radius), trailLength: clamp(o.trailLength, 0, 1), stars: clamp(Math.round(o.stars), 1, 6),
      glow: clamp(o.glow, 0, 1), dir: o.direction === 'counterclockwise' ? -1 : 1, hover: o.hover, clickPulse: o.clickPulse
    };
    const colors = { head: toRgb(o.color), tail: toRgb(o.trailColor || o.color) };

    root.classList.add('star-border');
    root.style.setProperty('--star-border-thickness', s.thickness + 'px');
    root.style.setProperty('--star-border-track', o.trackColor);
    const canvas = document.createElement('canvas');
    canvas.className = 'star-border__light';
    canvas.setAttribute('aria-hidden', 'true');
    root.prepend(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};

    const reduce = reduced();
    const point = { x: 0, y: 0, nx: 0, ny: -1 };
    const st = { width: 0, height: 0, dpr: 1, phase: 0, velocity: 0, motion: 0, lap: -1, time: 0, flash: 0, hovered: false, focused: false, visible: true };
    const pulses = [];
    let raf = 0;
    let last = performance.now();
    let alive = true;

    const shapeFor = () => outline(Math.max(1, st.width - s.thickness), Math.max(1, st.height - s.thickness), s.radius - s.thickness / 2);

    const measure = () => {
      st.width = root.offsetWidth;
      st.height = root.offsetHeight;
      st.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round((st.width + BLEED * 2) * st.dpr));
      canvas.height = Math.max(1, Math.round((st.height + BLEED * 2) * st.dpr));
      wake();
    };
    const local = e => {
      const rect = root.getBoundingClientRect();
      return [(e.clientX - rect.left) * (rect.width ? st.width / rect.width : 1), (e.clientY - rect.top) * (rect.height ? st.height / rect.height : 1)];
    };
    const stroke = (x1, y1, x2, y2, width, style) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const drawTrail = (shape, head, length, sign, intensity, tip = true) => {
      if (length < 0.5 || intensity <= 0) return;
      const steps = clamp(Math.ceil(length / 2), 2, 90);
      pointAt(shape, head, point);
      let px = point.x;
      let py = point.y;
      for (let i = 1; i <= steps; i++) {
        pointAt(shape, head - sign * length * (i / steps), point);
        const u = 1 - (i - 0.5) / steps;
        const fade = u * u * intensity;
        let tone = mix(colors.tail, colors.head, u);
        if (!s.light) tone = mix(tone, WHITE, u ** 6 * 0.65);
        ctx.lineCap = tip && i === 1 ? 'round' : 'butt';
        stroke(px, py, point.x, point.y, 2 + 6 * s.glow, rgba(tone, fade * (s.light ? 0.1 : 0.2) * s.glow));
        stroke(px, py, point.x, point.y, s.thickness, rgba(tone, fade));
        px = point.x;
        py = point.y;
      }
    };
    const drawHead = (x, y, intensity) => {
      if (intensity <= 0) return;
      const reach = (12 + 40 * s.glow) * (s.light ? 0.6 : 1);
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
      const strength = (s.light ? 0.08 : 0.4) * s.glow * intensity;
      bloom.addColorStop(0, rgba(colors.head, strength));
      bloom.addColorStop(0.2, rgba(colors.head, strength * 0.4));
      bloom.addColorStop(0.5, rgba(colors.head, strength * 0.1));
      bloom.addColorStop(1, rgba(colors.head, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    };

    const draw = shape => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (st.width < 2 || st.height < 2) return;
      const offset = (BLEED + s.thickness / 2) * st.dpr;
      ctx.setTransform(st.dpr, 0, 0, st.dpr, offset, offset);
      ctx.globalCompositeOperation = s.light ? 'source-over' : 'lighter';
      const total = shape.total;
      const spacing = total / s.stars;
      const speed = Math.abs(st.motion);
      const sign = st.motion >= 0 ? 1 : -1;
      const length = Math.min(speed * s.trailLength * s.duration, spacing * 0.92, total * 0.6);
      const intensity = 1 + 0.6 * st.flash;

      const ring = st.flash * (s.light ? 0.18 : 0.32);
      if (ring > 0.005 && ctx.roundRect) {
        ctx.lineWidth = s.thickness + 2 * s.glow;
        ctx.strokeStyle = rgba(colors.head, ring);
        ctx.beginPath();
        ctx.roundRect(0, 0, Math.max(1, st.width - s.thickness), Math.max(1, st.height - s.thickness), Math.max(0, shape.r));
        ctx.stroke();
      }

      const still = clamp(1 - speed / Math.max(1, (total / s.duration) * 0.6), 0, 1);
      const rest = (10 + 14 * s.glow + s.thickness * 2) * still;
      for (let i = 0; i < s.stars; i++) {
        const head = st.phase + i * spacing;
        drawTrail(shape, head, length, sign, 1);
        if (still > 0.01) {
          drawTrail(shape, head, rest, 1, still, false);
          drawTrail(shape, head, rest, -1, still, false);
        }
      }
      pulses.forEach(p => {
        const fade = (1 - p.age / 0.65) ** 2;
        const travel = (total / 2) * (1 - (1 - Math.min(1, p.age / 0.5)) ** 2);
        const tail = Math.min(travel, total * 0.16);
        [1, -1].forEach(way => {
          const front = p.origin + way * travel;
          drawTrail(shape, front, tail, way, fade);
          pointAt(shape, front, point);
          drawHead(point.x, point.y, fade * 0.8);
        });
      });
      for (let i = 0; i < s.stars; i++) {
        pointAt(shape, st.phase + i * spacing, point);
        drawHead(point.x, point.y, Math.min(1.3, intensity));
      }
    };

    const frame = now => {
      raf = 0;
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      st.time += dt;
      const shape = shapeFor();
      const total = shape.total;
      const cruise = reduce ? 0 : (s.dir * total) / s.duration;
      st.flash *= Math.exp(-dt / 0.22);
      st.velocity += (cruise - st.velocity) * (1 - Math.exp(-dt / 0.45));
      let extra = 0;
      if (st.lap >= 0) {
        const before = easeIO(Math.min(1, st.lap / LAP));
        st.lap += dt;
        extra = (easeIO(Math.min(1, st.lap / LAP)) - before) * total * s.dir;
        if (st.lap >= LAP) st.lap = -1;
      }
      st.motion = st.velocity + extra / dt;
      st.phase = wrap(st.phase + st.velocity * dt + extra, total);
      for (let i = pulses.length - 1; i >= 0; i--) {
        pulses[i].age += dt;
        if (pulses[i].age >= 0.65) pulses.splice(i, 1);
      }
      draw(shape);
      const settling = st.flash > 0.01 || pulses.length > 0;
      const moving = Math.abs(st.motion) > 0.05 || cruise !== 0 || st.lap >= 0;
      if (st.visible && !document.hidden && (settling || moving || st.hovered)) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (raf || !alive || !st.visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const onEnter = () => { st.hovered = true; if (s.hover === 'lap' && st.lap < 0 && !reduce) st.lap = 0; wake(); };
    const onLeave = () => { st.hovered = false; wake(); };
    const pulse = origin => {
      if (!s.clickPulse) return;
      pulses.push({ origin, age: 0 });
      if (pulses.length > 4) pulses.shift();
      st.flash = 1;
      wake();
    };
    const onDown = e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const [x, y] = local(e);
      pulse(project(shapeFor(), x - s.thickness / 2, y - s.thickness / 2));
    };
    const onClick = e => { if (e.detail === 0) pulse(st.phase); };
    const onFocus = () => { st.focused = root.matches(':focus-visible'); if (st.focused && st.lap < 0 && !reduce) st.lap = 0; wake(); };
    const onBlur = () => { st.focused = false; wake(); };
    const onVisibility = () => wake();

    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const io = new IntersectionObserver(entries => {
      st.visible = entries.some(e => e.isIntersecting);
      if (st.visible) wake();
    });
    io.observe(root);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    root.addEventListener('focus', onFocus);
    root.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    measure();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('click', onClick);
      root.removeEventListener('focus', onFocus);
      root.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
      root.classList.remove('star-border');
    };
  }

  /* =====================================================================
   * ClickSpark — شرارات صغيرة بتطلع من مكان الضغطة
   * الأصل بيلف العنصر بـcanvas؛ هون canvas واحد ثابت فوق الصفحة، وبيشتغل بس لما في شرارات.
   * ===================================================================== */
  function clickSpark(opts) {
    const o = Object.assign({
      selector: null, sparkColor: '#fff', sparkSize: 10, sparkRadius: 15, sparkCount: 8, duration: 400, easing: 'ease-out', extraScale: 1
    }, opts || {});
    if (reduced()) return () => {};
    const canvas = document.createElement('canvas');
    canvas.className = 'click-spark';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let sparks = [];
    let raf = 0;
    let dpr = 1;

    const ease = t => {
      switch (o.easing) {
        case 'linear': return t;
        case 'ease-in': return t * t;
        case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default: return t * (2 - t);
      }
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    const draw = now => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sparks = sparks.filter(sp => {
        const elapsed = now - sp.startTime;
        if (elapsed >= o.duration) return false;
        const eased = ease(elapsed / o.duration);
        const distance = eased * o.sparkRadius * o.extraScale;
        const lineLength = o.sparkSize * (1 - eased);
        ctx.strokeStyle = o.sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x + distance * Math.cos(sp.angle), sp.y + distance * Math.sin(sp.angle));
        ctx.lineTo(sp.x + (distance + lineLength) * Math.cos(sp.angle), sp.y + (distance + lineLength) * Math.sin(sp.angle));
        ctx.stroke();
        return true;
      });
      raf = sparks.length ? requestAnimationFrame(draw) : 0;
    };
    const onClick = e => {
      if (e.detail === 0) return; // ضغطة من الكيبورد ما إلها مكان على الشاشة
      if (o.selector && !(e.target.closest && e.target.closest(o.selector))) return;
      const now = performance.now();
      for (let i = 0; i < o.sparkCount; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, angle: (TAU * i) / o.sparkCount, startTime: now });
      }
      if (!raf) raf = requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('click', onClick, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('click', onClick, true);
      canvas.remove();
    };
  }

  window.OLVBits = { aurora, splitText, blurText, shinyText, starBorder, clickSpark };
})();
