const TRACK_WIDTH = 520;
const TRACK_HEIGHT = 272;
const TRAVEL = 248;
const KNOB_SIZE = 240;
const KNOB_RADIUS = 69;
const GRID = 6.85;
const MASK_SIZE = 256;
const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const follow = (current, target, rate, dt) => mix(current, target, 1 - Math.exp(-rate * dt));

function makeMoon() {
  const cells = [];
  for (let y = -8; y <= 8; y++) {
    for (let x = -8; x <= 8; x++) {
      if (Math.hypot(x, y) > 6.6) continue;
      const lit = Math.hypot(x - 3.3, y + 2.4) > 5.4;
      if (lit || (x + y) % 2 === 0) cells.push({ x, y, alpha: lit ? 1 : 0.15 });
    }
  }
  cells.push(
    { x: 7, y: -7, alpha: 1 },
    { x: 6, y: -7, alpha: 0.45 },
    { x: 8, y: -7, alpha: 0.45 },
    { x: 7, y: -8, alpha: 0.45 },
    { x: 7, y: -6, alpha: 0.45 },
  );
  return cells;
}

function makeSun() {
  const cells = new Map();
  const add = (x, y) => cells.set(`${x},${y}`, { x, y, alpha: 1 });
  for (let y = -3; y <= 3; y++) {
    for (let x = -3; x <= 3; x++) {
      if (Math.hypot(x, y) <= 3.7) add(x, y);
    }
  }
  for (let ray = 0; ray < 8; ray++) {
    const angle = (ray * Math.PI) / 4;
    for (const distance of ray % 2 === 0 ? [5.6, 6.6, 7.6] : [5.9, 7.2]) {
      add(Math.round(Math.cos(angle) * distance), Math.round(Math.sin(angle) * distance));
    }
  }
  return [...cells.values()];
}

const MOON = makeMoon();
const SUN = makeSun();
const PARTICLE_COUNT = Math.max(MOON.length, SUN.length) + 20;

function makeParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    // Equal-area samples of the ellipse, ordered by the golden angle.
    const radius = Math.sqrt((index + 0.5) / PARTICLE_COUNT);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return {
      anchorX: 74 * radius * Math.cos(angle),
      anchorY: 63 * radius * Math.sin(angle),
      angle,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      targetX: 0,
      targetY: 0,
      alpha: 0,
      targetAlpha: 0,
    };
  });
}

function assignCells(particles, day) {
  const cells = day ? SUN : MOON;
  // Assign nearby particles first to keep reversals coherent when the paths cross.
  const available = new Set(particles);
  for (const cell of cells) {
    const x = cell.x * GRID;
    const y = cell.y * GRID;
    let nearest;
    let nearestDistance = Infinity;
    for (const particle of available) {
      const distance = (particle.x - x) ** 2 + (particle.y - y) ** 2 + 240 * (1 - particle.alpha);
      if (distance < nearestDistance) {
        nearest = particle;
        nearestDistance = distance;
      }
    }
    available.delete(nearest);
    nearest.targetX = x;
    nearest.targetY = y;
    nearest.targetAlpha = cell.alpha;
  }
  for (const particle of available) {
    particle.targetX = particle.anchorX * 0.35;
    particle.targetY = particle.anchorY * 0.35;
    particle.targetAlpha = 0;
  }
}

function drawPixels(ctx, particles, spread) {
  for (const particle of particles) {
    if (particle.alpha < 0.003) continue;
    const speedShrink = Math.min(0.35, Math.hypot(particle.vx, particle.vy) / 600);
    const size = GRID * 0.82 * (1 - speedShrink) * (1 - 0.35 * spread);
    ctx.globalAlpha = particle.alpha;
    ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

const STYLES = `
  .pixel-toggle-scene {
    position: relative; display: block; width: 100%; max-width: 720px; min-width: 0;
    aspect-ratio: 4 / 3; margin-inline: auto; isolation: isolate;
  }
  .pixel-toggle-scene[data-embedded] { max-width: none; aspect-ratio: 572 / 310; }
  .pixel-toggle-scene canvas, .pixel-toggle-backdrop {
    position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
  }
  .pixel-toggle-scene [hidden] { display: none !important; }
  .pixel-toggle-backdrop {
    overflow: hidden;
    background: radial-gradient(ellipse 140% 155% at 92% -8%, var(--pixel-top), var(--pixel-bottom));
  }
  .pixel-toggle-scene[data-embedded] .pixel-toggle-backdrop { background: transparent; }
  .pixel-toggle-plane { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
  .pixel-toggle-track {
    position: absolute; left: -260px; top: -136px; width: 520px; height: 272px;
    border-radius: 86px; box-sizing: border-box; background: var(--pixel-track);
    box-shadow: 0 17px 37px -12px var(--pixel-shadow),
      inset 0 1px rgb(0 0 0 / .25), inset 0 -1px rgb(255 255 255 / .22);
  }
  .pixel-toggle-glass {
    position: absolute; box-sizing: border-box; display: grid; place-items: center;
    background: linear-gradient(145deg, var(--pixel-glass-top), var(--pixel-glass-bottom));
    box-shadow: inset 1px 1px 2px var(--pixel-rim), inset -1px -2px 4px rgb(0 0 0 / .14),
      0 6px 18px rgb(0 0 0 / .2);
  }
  .pixel-toggle-switch {
    position: absolute; display: block; margin: 0; padding: 0; border: 0;
    appearance: none; background: transparent; color: inherit; cursor: grab;
    touch-action: pan-y; user-select: none; -webkit-tap-highlight-color: transparent;
    -webkit-app-region: no-drag;
  }
  .pixel-toggle-switch:active { cursor: grabbing; }
  .pixel-toggle-switch:focus-visible {
    outline: 2px solid #6f86ff; outline-offset: 3px;
  }
  .pixel-toggle-scene[data-day] .pixel-toggle-switch:focus-visible { outline-color: #80531a; }
`;

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 vertex = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vertex * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 resolution;
uniform vec2 sceneSize;
uniform vec2 center;
uniform vec2 halfSize;
uniform float scale;
uniform float radius;
uniform float theme;
uniform float phase;
uniform bool embedded;
uniform sampler2D mask;
out vec4 outputColor;

float roundedBox(vec2 p, vec2 halfExtent, float r) {
  vec2 q = abs(p) - halfExtent + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 outerNormal(vec2 p, vec2 halfExtent, float r) {
  vec2 q = abs(p) - halfExtent + r;
  vec2 corner = max(q, 0.0);
  if (dot(corner, corner) > 0.0001) return normalize(corner) * sign(p);
  return q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
}

vec4 over(vec4 base, vec3 color, float opacity) {
  opacity = clamp(opacity, 0.0, 1.0);
  return vec4(color * opacity, opacity) + base * (1.0 - opacity);
}

float pixelMask(vec2 p) {
  return texture(mask, p / 256.0 + 0.5).a;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution;
  vec2 p = (uv - 0.5) * sceneSize / scale;
  float aa = max(0.55, 0.66 * length(sceneSize / resolution) / scale);
  vec3 top = mix(vec3(0.1294, 0.1294, 0.1373), vec3(0.9255, 0.9255, 0.9176), theme);
  vec3 bottom = mix(vec3(0.051, 0.051, 0.0549), vec3(0.8039, 0.8039, 0.8), theme);
  float gradient = clamp(length((uv - vec2(0.92, -0.08)) / vec2(1.4, 1.55)), 0.0, 1.0);
  vec4 color = embedded ? vec4(0.0) : vec4(mix(top, bottom, gradient), 1.0);

  float track = roundedBox(p, vec2(260.0, 136.0), 86.0);
  float trackShadow = roundedBox(p - vec2(0.0, 17.0), vec2(254.0, 129.0), 84.0);
  color = over(color, mix(vec3(0.012), vec3(0.22), theme),
    exp(-max(trackShadow, 0.0) / 17.0) * (embedded ? 0.18 : 0.39));
  float trackFill = 1.0 - smoothstep(-aa, aa, track);
  vec2 trackNormal = outerNormal(p, vec2(260.0, 136.0), 86.0);
  float trackRim = 1.0 - smoothstep(0.0, max(1.0, aa), abs(track + 0.5));
  vec3 trackColor = mix(vec3(0.036, 0.035, 0.041), vec3(0.901, 0.901, 0.897), theme);
  trackColor += trackRim * (0.075 * trackNormal.y - 0.013);
  color = over(color, trackColor, trackFill);

  vec2 q = p - center;
  float glass = roundedBox(q, halfSize, radius);
  float fill = 1.0 - smoothstep(-aa, aa, glass);
  float depth = max(-glass, 0.0);
  vec2 normal = outerNormal(q, halfSize, radius);
  float centerAngle = 1.57079633 - 6.28318531 * phase;
  float pointAngle = atan(q.y, q.x + 0.0001);
  float angle = abs(mod(pointAngle - centerAngle + 3.14159265, 6.28318531) - 3.14159265);
  float arc = 1.0 - smoothstep(0.44, 0.92, angle);
  float lightDistance = abs(glass - 8.0);
  vec3 light = mix(vec3(0.4353, 0.5255, 1.0), vec3(1.0, 0.6588, 0.1804), theme);
  float halo = 0.43 * exp(-lightDistance / 21.0) + 0.33 * exp(-lightDistance / 85.0);
  float band = 1.0 - smoothstep(0.0, 1.8 + aa, lightDistance);
  float outside = arc * (halo * mix(0.57, 0.33, theme) + 0.66 * band);
  if (embedded) outside *= (1.0 - smoothstep(12.0, 28.0, track));
  if (!embedded) {
    color.rgb += light * outside * (1.0 - theme);
    color = over(color, light, outside * theme);
  } else {
    color = over(color, light, outside);
  }
  float core = 1.0 - smoothstep(0.0, 0.65 + aa * 0.55, lightDistance);
  color = over(color, mix(light, vec3(1.0, 0.96, 0.86), 0.54), arc * core * 0.64);
  float glassShadow = roundedBox(q - vec2(0.0, 6.0), halfSize, radius);
  color = over(color, vec3(0.0), exp(-max(glassShadow, 0.0) / 7.0) * 0.24 * trackFill);

  if (fill > 0.0) {
    float tilt = clamp(0.5 + dot(q / halfSize, vec2(0.23, 0.36)), 0.0, 1.0);
    vec3 surface = mix(
      mix(vec3(0.36, 0.363, 0.39), vec3(0.155, 0.155, 0.174), tilt),
      mix(vec3(0.996, 0.994, 0.988), vec3(0.87, 0.868, 0.862), tilt),
      theme
    );
    float highlight = max(0.0, dot(normal, normalize(vec2(-0.7, -1.0))));
    surface += exp(-depth / 1.5) * (0.20 * highlight - 0.07 * (1.0 - highlight));
    float slope = pow(1.0 - clamp(depth / 31.0, 0.0, 1.0), 2.6);
    vec2 refracted = q * 0.945 - normal * slope * 47.0;
    vec2 separation = normal * slope * 1.25;
    vec3 shape = vec3(pixelMask(refracted));
    if (slope > 0.0001) {
      shape.r = pixelMask(refracted + separation);
      shape.b = pixelMask(refracted - separation);
    }
    float frost = 0.0;
    if (slope > 0.0001 || theme < 0.98) {
      frost = (
        pixelMask(refracted + vec2(4.0, 0.0)) + pixelMask(refracted - vec2(4.0, 0.0)) +
        pixelMask(refracted + vec2(0.0, 4.0)) + pixelMask(refracted - vec2(0.0, 4.0))
      ) * 0.25;
    }
    shape = mix(shape, vec3(frost), 0.7 * slope);
    vec3 ink = mix(vec3(1.0, 0.951, 0.83), vec3(0.135, 0.13, 0.12), theme);
    surface = mix(surface, ink, shape);
    surface += vec3(1.0, 0.85, 0.6) * frost * 0.075 * (1.0 - theme);
    float inner = arc * (0.15 * exp(-depth / 28.0) + 0.09 * exp(-depth / 73.0));
    float refractionRim = arc * 0.55 * exp(-depth / 2.8);
    surface += light * (inner + refractionRim) * (1.0 - theme);
    surface = mix(surface, light, (inner + refractionRim) * theme);
    uvec2 cell = uvec2(gl_FragCoord.xy);
    uint hash = cell.x * 1664525u + cell.y * 1013904223u;
    hash = (hash ^ (hash >> 16u)) * 2246822519u;
    float grain = float((hash ^ (hash >> 13u)) & 255u) / 255.0 - 0.5;
    color = over(color, clamp(surface + grain * 0.04, 0.0, 1.0), fill);
  }
  outputColor = color;
}`;

function makeWebGLRenderer(canvas, gl) {
  if (!gl || gl.isContextLost()) return null;
  const mask = canvas.ownerDocument.createElement("canvas");
  mask.width = mask.height = MASK_SIZE;
  const ctx = mask.getContext("2d");
  if (!ctx) return null;

  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  const texture = gl.createTexture();
  function destroy() {
    gl.useProgram(null);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
  }
  gl.shaderSource(vertex, VERTEX_SHADER);
  gl.shaderSource(fragment, FRAGMENT_SHADER);
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    destroy();
    return null;
  }
  const uniforms = Object.fromEntries(
    ["resolution", "sceneSize", "center", "halfSize", "scale", "radius", "theme", "phase", "embedded", "mask"].map(
      (name) => [name, gl.getUniformLocation(program, name)],
    ),
  );
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASK_SIZE, MASK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.uniform1i(uniforms.mask, 0);
  let validated = false;

  return {
    draw(frame) {
      ctx.setTransform(1, 0, 0, 1, MASK_SIZE / 2, MASK_SIZE / 2);
      ctx.clearRect(-MASK_SIZE / 2, -MASK_SIZE / 2, MASK_SIZE, MASK_SIZE);
      ctx.fillStyle = "white";
      drawPixels(ctx, frame.particles, frame.spread);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform2f(uniforms.sceneSize, frame.sceneWidth, frame.sceneHeight);
      gl.uniform2f(uniforms.center, frame.center, 0);
      gl.uniform2f(uniforms.halfSize, frame.width / 2, frame.height / 2);
      gl.uniform1f(uniforms.scale, frame.scale);
      gl.uniform1f(uniforms.radius, frame.radius);
      gl.uniform1f(uniforms.theme, frame.theme);
      gl.uniform1f(uniforms.phase, frame.phase % 1);
      gl.uniform1i(uniforms.embedded, Number(frame.embedded));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Some drivers compile the linked shader on the first actual draw.
      if (!validated) validated = gl.getError() === gl.NO_ERROR;
      return validated;
    },
    destroy,
  };
}

function color(a, b, theme, alpha = 1) {
  const channels = a.map((channel, index) => Math.round(mix(channel, b[index], theme))).join(" ");
  return `rgb(${channels} / ${alpha})`;
}

function setKnobStyle(element, frame) {
  Object.assign(element.style, {
    left: `${frame.center - frame.width / 2}px`,
    top: `${-frame.height / 2}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    borderRadius: `${frame.radius}px`,
  });
}

function traceLight(ctx, frame, offset) {
  const centerAngle = Math.PI / 2 - TAU * frame.phase;
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  const ends = [];
  ctx.beginPath();
  for (let sample = 0; sample <= 40; sample++) {
    const angle = centerAngle + mix(-0.92, 0.92, sample / 40);
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    let inside = 0;
    let outside = Math.hypot(halfWidth, halfHeight) + 12;
    // Intersect a ray with the same rounded rectangular contour as the glass.
    for (let step = 0; step < 11; step++) {
      const distance = (inside + outside) / 2;
      const dx = Math.abs(x * distance) - halfWidth + frame.radius;
      const dy = Math.abs(y * distance) - halfHeight + frame.radius;
      const sdf = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - frame.radius;
      if (sdf < offset) inside = distance;
      else outside = distance;
    }
    const distance = (inside + outside) / 2;
    const point = [x * distance, y * distance];
    if (sample === 0) ctx.moveTo(...point);
    else ctx.lineTo(...point);
    if (sample === 0 || sample === 40) ends.push(...point);
  }
  return ends;
}

function strokeLight(ctx, ends, width, paint, opacity) {
  const gradient = ctx.createLinearGradient(...ends);
  gradient.addColorStop(0, paint(0));
  gradient.addColorStop(0.22, paint(opacity));
  gradient.addColorStop(0.78, paint(opacity));
  gradient.addColorStop(1, paint(0));
  ctx.lineWidth = width;
  ctx.strokeStyle = gradient;
  ctx.stroke();
}

function drawFallback(canvas, ctx, backdrop, plane, glass, glyph, frame) {
  const { theme, scale, particles } = frame;
  backdrop.style.setProperty("--pixel-top", color([33, 33, 35], [236, 236, 234], theme));
  backdrop.style.setProperty("--pixel-bottom", color([13, 13, 14], [205, 205, 204], theme));
  backdrop.style.setProperty("--pixel-track", color([9, 9, 10], [230, 230, 229], theme));
  backdrop.style.setProperty("--pixel-shadow", color([0, 0, 0], [48, 46, 45], theme, 0.32));
  backdrop.style.setProperty("--pixel-glass-top", color([94, 95, 103], [254, 253, 252], theme, 0.97));
  backdrop.style.setProperty("--pixel-glass-bottom", color([39, 39, 44], [225, 224, 221], theme, 0.98));
  backdrop.style.setProperty("--pixel-rim", color([155, 157, 170], [255, 255, 255], theme, 0.8));
  plane.style.transform = `scale(${scale})`;
  setKnobStyle(glass, frame);

  const pixelInk = color([255, 242, 212], [34, 33, 31], theme);
  if (!ctx) {
    for (const [index, particle] of particles.entries()) {
      const pixel = glyph.children[index];
      pixel.style.cssText = `position:absolute;left:calc(50% + ${particle.x}px);top:calc(50% + ${particle.y}px);
        width:5.62px;height:5.62px;transform:translate(-50%,-50%);background:${pixelInk};opacity:${particle.alpha}`;
    }
    return;
  }

  const ratioX = canvas.width / frame.sceneWidth;
  const ratioY = canvas.height / frame.sceneHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * ratioX, 0, 0, scale * ratioY, canvas.width / 2, canvas.height / 2);
  ctx.translate(frame.center, 0);

  const light = (alpha) => color([111, 134, 255], [255, 168, 46], theme, alpha);
  ctx.lineCap = "round";
  const outer = traceLight(ctx, frame, 8);
  for (const [lineWidth, alpha] of [
    [64, 0.08],
    [18, 0.19],
    [9, 0.33],
    [3.5, 0.88],
  ]) {
    ctx.filter = lineWidth === 64 ? `blur(${Math.max(1, 9 * scale * ratioX)}px)` : "none";
    strokeLight(ctx, outer, lineWidth, light, alpha);
  }
  strokeLight(ctx, outer, 1.15, (alpha) => color([204, 215, 255], [255, 227, 181], theme, alpha), 0.86);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height, frame.radius);
  ctx.clip();
  const inner = traceLight(ctx, frame, -3);
  for (const [lineWidth, alpha] of [
    [64, 0.075],
    [18, 0.13],
    [3.5, 0.4],
  ]) {
    strokeLight(ctx, inner, lineWidth, light, alpha);
  }
  ctx.scale(1 / 0.945, 1 / 0.945);
  ctx.fillStyle = pixelInk;
  ctx.shadowBlur = 2 * scale * ratioX * (1 - theme);
  ctx.shadowColor = "rgba(255, 226, 178, 0.6)";
  drawPixels(ctx, particles, frame.spread);
  ctx.restore();
}

function makeClickSound(view, document) {
  let audio;
  let generation = 0;
  const playing = new Set();

  return {
    async play(day) {
      const Audio = view.AudioContext ?? view.webkitAudioContext;
      if (!Audio || document.hidden) return;
      const request = generation;
      try {
        audio ??= new Audio();
        if (audio.state === "suspended") await audio.resume();
        if (request !== generation || document.hidden || audio.state !== "running") return;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(day ? 1500 : 900, start);
        oscillator.frequency.exponentialRampToValueAtTime(day ? 2300 : 480, start + 0.1);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.045, start + 0.009);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
        oscillator.connect(gain).connect(audio.destination);
        playing.add(oscillator);
        oscillator.onended = () => {
          playing.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.1);
      } catch {
        // Audio may be blocked or unavailable. The switch still responds visually.
      }
    },
    stop() {
      generation++;
      for (const oscillator of playing) oscillator.stop();
    },
    destroy() {
      this.stop();
      if (audio && audio.state !== "closed") void audio.close().catch(() => {});
    },
  };
}

export function mountPixelToggle(host, initialOptions = {}) {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const controller = new view.AbortController();
  const { signal } = controller;
  const motionPreference = view.matchMedia("(prefers-reduced-motion: reduce)");
  const audio = makeClickSound(view, document);
  const create = (tag, className, parent) => {
    const element = document.createElement(tag);
    element.className = className;
    parent.append(element);
    return element;
  };

  let options = initialOptions;
  let day = options.checked ?? false;
  let position = Number(day);
  let velocity = 0;
  let theme = position;
  let phase = position / 2;
  let themeMotion;
  let phaseMotion;
  let press = 0;
  let stretch = 0;
  let stretchVelocity = 0;
  let disturbance = 0;
  let assignedDay = day;
  let pointer;
  let hover;
  let suppressPointerClick = false;
  let frameId = 0;
  let lastFrame = 0;
  let sceneWidth = 0;
  let sceneHeight = 0;
  let scale = 1;
  let active = true;
  let rendererName;
  let renderer;
  let glContext;
  let fallbackContext;
  const particles = makeParticles();
  const scene = create("div", "pixel-toggle-scene", host);
  create("style", "", scene).textContent = STYLES;
  const backdrop = create("div", "pixel-toggle-backdrop", scene);
  const plane = create("div", "pixel-toggle-plane", backdrop);
  create("div", "pixel-toggle-track", plane);
  const glass = create("div", "pixel-toggle-glass", plane);
  const glyph = create("div", "", glass);
  const glCanvas = create("canvas", "", scene);
  const fallbackCanvas = create("canvas", "", scene);
  const button = create("button", "pixel-toggle-switch", scene);
  backdrop.setAttribute("aria-hidden", "true");
  glCanvas.setAttribute("aria-hidden", "true");
  fallbackCanvas.setAttribute("aria-hidden", "true");
  button.type = "button";
  button.setAttribute("role", "switch");

  const now = () => view.performance.now();
  const reduce = () => options.reducedMotion ?? motionPreference.matches;
  const isDragging = () => Boolean(pointer?.dragging);

  function configureRenderer() {
    const next = renderer ? "webgl2" : fallbackContext ? "canvas2d" : "css";
    glCanvas.hidden = !renderer;
    backdrop.hidden = Boolean(renderer);
    fallbackCanvas.hidden = Boolean(renderer) || !fallbackContext;
    glyph.hidden = next !== "css";
    if (next === "css" && !glyph.firstChild) {
      glyph.append(...particles.map(() => document.createElement("span")));
    }
    if (rendererName !== next) {
      rendererName = next;
      options.onRendererChange?.(next);
    }
  }

  function initRenderer() {
    renderer?.destroy();
    try {
      glContext = glCanvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
      renderer = makeWebGLRenderer(glCanvas, glContext);
    } catch {
      renderer = null;
    }
    if (!renderer) initFallback();
    else configureRenderer();
  }

  function initFallback() {
    renderer?.destroy();
    renderer = null;
    fallbackContext ??= fallbackCanvas.getContext("2d");
    configureRenderer();
  }

  function updateAttributes() {
    const label = options.label || "Day mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-checked", String(day));
    scene.toggleAttribute("data-day", day);
    scene.toggleAttribute("data-embedded", Boolean(options.embedded));
    scene.style.height = typeof options.height === "number" ? `${options.height}px` : (options.height ?? "");
  }

  function geometry() {
    const compression = 1 - press * 0.055;
    let width = KNOB_SIZE * compression * (1 + stretch);
    let height = KNOB_SIZE * compression * (1 - stretch * 0.45);
    let center = TRAVEL * (position - 0.5);
    const wall = TRACK_WIDTH / 2 - 16;
    const excess = Math.max(0, Math.abs(center) + width / 2 - wall);
    if (excess > 0) {
      const squash = Math.min(0.16, (excess / TRAVEL) * 1.12);
      width *= 1 - squash;
      height *= 1 + squash * 0.42;
      center = Math.sign(center) * (wall - width / 2);
    }
    return { center, width, height, radius: (KNOB_RADIUS * Math.min(width, height)) / KNOB_SIZE };
  }

  function draw() {
    if (!sceneWidth || !sceneHeight) return;
    const frame = {
      ...geometry(),
      theme,
      phase,
      scale,
      sceneWidth,
      sceneHeight,
      particles,
      embedded: Boolean(options.embedded),
      spread: spreadAmount(),
    };
    if (renderer) {
      if (!renderer.draw(frame)) {
        initFallback();
        resize();
      }
    } else {
      drawFallback(fallbackCanvas, fallbackContext, backdrop, plane, glass, glyph, frame);
    }
  }

  function resize() {
    if (!active || document.hidden) return;
    const bounds = scene.getBoundingClientRect();
    sceneWidth = bounds.width;
    sceneHeight = bounds.height;
    if (!sceneWidth || !sceneHeight) return;
    scale = options.embedded
      ? Math.min(sceneWidth / 572, sceneHeight / 310)
      : 0.83 * Math.min(sceneWidth / 720, sceneHeight / 540);
    const pixelRatio = Math.min(view.devicePixelRatio || 1, Math.sqrt(1_200_000 / (sceneWidth * sceneHeight)));
    const width = Math.max(1, Math.floor(sceneWidth * pixelRatio));
    const height = Math.max(1, Math.floor(sceneHeight * pixelRatio));
    for (const canvas of [glCanvas, fallbackCanvas]) {
      const bufferWidth = canvas.hidden ? 1 : width;
      const bufferHeight = canvas.hidden ? 1 : height;
      if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
      if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    }
    Object.assign(button.style, {
      left: `${(sceneWidth - TRACK_WIDTH * scale) / 2}px`,
      top: `${(sceneHeight - TRACK_HEIGHT * scale) / 2}px`,
      width: `${TRACK_WIDTH * scale}px`,
      height: `${TRACK_HEIGHT * scale}px`,
      borderRadius: `${86 * scale}px`,
    });
    draw();
  }

  function snapParticles() {
    if (assignedDay !== theme >= 0.5) {
      assignedDay = theme >= 0.5;
      assignCells(particles, assignedDay);
    }
    for (const particle of particles) {
      particle.x = particle.targetX;
      particle.y = particle.targetY;
      particle.alpha = particle.targetAlpha;
      particle.vx = particle.vy = 0;
    }
  }

  function finish() {
    view.cancelAnimationFrame(frameId);
    frameId = lastFrame = 0;
    theme = position = Number(day);
    phase = position / 2;
    velocity = press = stretch = stretchVelocity = disturbance = 0;
    themeMotion = phaseMotion = hover = undefined;
    snapParticles();
    draw();
  }

  function wake() {
    if (!frameId && !document.hidden && active && !reduce()) frameId = view.requestAnimationFrame(tick);
  }

  function spreadAmount() {
    return reduce() ? 0 : Math.max(disturbance, clamp(1 - Math.abs(2 * theme - 1) * 1.6));
  }

  function moveParticles(dt, time) {
    if (assignedDay !== theme >= 0.5) {
      assignedDay = theme >= 0.5;
      assignCells(particles, assignedDay);
    }
    const spread = spreadAmount();
    const cursor = hover && time - hover.time < 160 ? hover : undefined;
    const { center } = geometry();
    let moving = false;
    for (const particle of particles) {
      const wave = time * 0.009 + particle.angle;
      const x = mix(particle.targetX, particle.anchorX, spread) + Math.sin(wave) * 6 * spread;
      const y = mix(particle.targetY, particle.anchorY, spread) + Math.cos(wave) * 6 * spread;
      let ax = (x - particle.x) * 340 - particle.vx * 27;
      let ay = (y - particle.y) * 340 - particle.vy * 27;
      if (cursor) {
        const dx = particle.x + center - cursor.x;
        const dy = particle.y - cursor.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < 49) {
          const force = (2800 * (1 - (distance / 49) ** 2)) / distance;
          ax += dx * force;
          ay += dy * force;
        }
      }
      particle.vx += ax * dt;
      particle.vy += ay * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const alpha = particle.targetAlpha * (1 - 0.34 * spread);
      const rate = alpha > particle.alpha ? 9 : 12;
      particle.alpha += clamp(alpha - particle.alpha, -rate * dt, rate * dt);
      moving ||=
        Math.abs(particle.x - x) + Math.abs(particle.y - y) > 0.035 ||
        Math.abs(particle.vx) + Math.abs(particle.vy) > 0.25 ||
        Math.abs(alpha - particle.alpha) > 0.002;
    }
    return moving || Boolean(cursor);
  }

  function tick(time) {
    frameId = 0;
    const dt = lastFrame ? clamp((time - lastFrame) / 1000, 0, 0.033) : 1 / 60;
    lastFrame = time;
    const dragging = isDragging();
    let positionMoving;
    if (dragging) {
      const dragTheme = 1 / (1 + Math.exp(-(position - 0.5) / 0.07));
      const dragPhase = position / 2 + pointer.phaseTurn;
      theme = follow(theme, dragTheme, 14, dt);
      phase = follow(phase, dragPhase, 18, dt);
      velocity = time - pointer.movedAt < 85 ? (pointer.speed * 1000) / TRAVEL : 0;
      positionMoving = Math.abs(theme - dragTheme) > 0.0002 || Math.abs(phase - dragPhase) > 0.0002;
    } else {
      if (themeMotion) {
        const progress = clamp((time - themeMotion.start) / themeMotion.duration);
        theme = mix(themeMotion.from, Number(day), progress * progress * (3 - 2 * progress));
        if (progress === 1) themeMotion = undefined;
      }
      if (phaseMotion) {
        const progress = clamp((time - phaseMotion.start) / phaseMotion.duration);
        phase = mix(phaseMotion.from, phaseMotion.to, 1 - (1 - progress) ** 3);
        if (progress === 1) phaseMotion = undefined;
      }
    }
    const pressTarget = pointer ? 1 : 0;
    press = follow(press, pressTarget, pointer ? 30 : 21, dt);
    disturbance = follow(disturbance, 0, 7, dt);
    if (disturbance < 0.002) disturbance = 0;
    for (let step = 0; step < 4; step++) {
      const substep = dt / 4;
      if (!dragging) {
        velocity += (224 * (Number(day) - position) - 15.5 * velocity) * substep;
        position += velocity * substep;
      }
      const stretchTarget = Math.min(0.18, Math.abs(velocity) * 0.024);
      stretchVelocity += (420 * (stretchTarget - stretch) - 24 * stretchVelocity) * substep;
      stretch += stretchVelocity * substep;
    }
    if (!dragging) positionMoving = Math.abs(position - Number(day)) > 0.0003;
    const pixelsMoving = moveParticles(dt, time);
    if (
      themeMotion ||
      phaseMotion ||
      disturbance ||
      pixelsMoving ||
      positionMoving ||
      Math.abs(velocity) > 0.005 ||
      Math.abs(stretch) > 0.0003 ||
      Math.abs(stretchVelocity) > 0.006 ||
      Math.abs(press - pressTarget) > 0.001
    ) {
      draw();
      wake();
    } else if (pointer) {
      press = pressTarget;
      lastFrame = 0;
      draw();
    } else {
      finish();
    }
  }

  function disturb(amount) {
    disturbance = clamp(Math.max(disturbance, amount));
    for (const particle of particles) {
      particle.vx += Math.cos(particle.angle) * amount * 135;
      particle.vy += Math.sin(particle.angle) * amount * 135;
    }
  }

  function select(next, input = "external", trusted = false) {
    const changed = day !== next;
    day = next;
    updateAttributes();
    if (reduce() || document.hidden) {
      finish();
    } else {
      const time = now();
      const rest = Number(day) / 2;
      const release = input === "drag" || input === "cancel";
      const turn = release ? Math.round(phase - rest) : Math.ceil(phase + 0.1 - rest);
      themeMotion = { from: theme, start: time, duration: release ? 140 : day ? 100 : 70 };
      phaseMotion = { from: phase, to: rest + turn, start: time + (release ? 0 : 10), duration: release ? 700 : 900 };
      if (input === "click") {
        press = Math.max(0.65, press);
        disturb(0.94);
      }
      wake();
    }
    if (trusted && input === "click" && options.sound !== false) void audio.play(day);
    if (changed && (input === "click" || input === "drag")) options.onCheckedChange?.(day);
  }

  function point(event) {
    const bounds = button.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - bounds.width / 2) / scale,
      y: (event.clientY - bounds.top - bounds.height / 2) / scale,
    };
  }

  function releasePointer(suppressClick) {
    if (!pointer) return;
    const { id } = pointer;
    pointer = undefined;
    suppressPointerClick = suppressClick;
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
  }

  function onPointerDown(event) {
    if (pointer || !event.isPrimary || event.button !== 0) return;
    suppressPointerClick = false;
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startPosition: position,
      dragging: false,
      movedAt: now(),
      lastX: event.clientX,
      speed: 0,
      phaseTurn: 0,
    };
    button.setPointerCapture(event.pointerId);
    if (!reduce()) disturb(0.38);
    wake();
  }

  function trackDrag(event, time) {
    const delta = (event.clientX - pointer.startX) / scale;
    if (!pointer.dragging) {
      if (Math.abs(delta) <= 3) return;
      pointer.dragging = true;
      pointer.phaseTurn = Math.round(phase - clamp(position) / 2);
      themeMotion = phaseMotion = undefined;
    }
    const target = pointer.startPosition + delta / TRAVEL;
    const edge = clamp(target);
    const excess = target - edge;
    position = edge + Math.sign(excess) * 0.05 * Math.abs(excess) ** 0.6;
    if (event.clientX !== pointer.lastX) {
      const elapsed = Math.max(1, time - pointer.movedAt);
      const sample = (event.clientX - pointer.lastX) / scale / elapsed;
      pointer.speed =
        elapsed > 80 || Math.sign(sample) !== Math.sign(pointer.speed) ? sample : mix(pointer.speed, sample, 0.7);
      pointer.lastX = event.clientX;
      pointer.movedAt = time;
      if (!reduce() && Math.abs(pointer.speed) > 0.3) disturb(Math.min(0.88, Math.abs(pointer.speed) * 0.5));
    }
  }

  function onPointerMove(event) {
    const time = now();
    if (event.pointerType === "mouse") hover = { ...point(event), time };
    if (pointer?.id === event.pointerId) {
      trackDrag(event, time);
      if (reduce() && pointer.dragging) {
        theme = 1 / (1 + Math.exp(-(position - 0.5) / 0.07));
        phase = clamp(position) / 2;
        snapParticles();
        draw();
      }
    }
    wake();
  }

  function onPointerUp(event) {
    if (pointer?.id !== event.pointerId) return;
    const time = now();
    trackDrag(event, time);
    const { dragging, movedAt, speed } = pointer;
    const flick = time - movedAt <= 80 && Math.abs(speed) > 0.6;
    releasePointer(dragging);
    if (dragging) {
      hover = undefined;
      velocity = clamp((speed * 1000) / TRAVEL, -6, 6) * Number(time - movedAt <= 80);
      select(flick ? speed > 0 : position >= 0.5, "drag");
    } else {
      wake();
    }
  }

  function cancelPointer(event) {
    if (pointer?.id !== event.pointerId) return;
    releasePointer(true);
    hover = undefined;
    select(day, "cancel");
  }

  function onClick(event) {
    if (event.detail !== 0 && suppressPointerClick) {
      suppressPointerClick = false;
      return;
    }
    select(!day, "click", event.isTrusted);
  }

  function onVisibility() {
    if (!document.hidden) {
      resize();
      return;
    }
    releasePointer(true);
    audio.stop();
    finish();
  }

  function onMotionChange() {
    if (reduce()) {
      releasePointer(true);
      finish();
    }
  }

  const observer = new view.ResizeObserver(resize);
  observer.observe(scene);
  view.addEventListener("resize", resize, { signal });
  document.addEventListener("visibilitychange", onVisibility, { signal });
  motionPreference.addEventListener("change", onMotionChange, { signal });
  glCanvas.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      initFallback();
      resize();
    },
    { signal },
  );
  glCanvas.addEventListener(
    "webglcontextrestored",
    () => {
      initRenderer();
      resize();
    },
    { signal },
  );
  button.addEventListener("pointerdown", onPointerDown, { signal });
  button.addEventListener("pointermove", onPointerMove, { signal });
  button.addEventListener("pointerup", onPointerUp, { signal });
  button.addEventListener("pointercancel", cancelPointer, { signal });
  button.addEventListener("lostpointercapture", cancelPointer, { signal });
  button.addEventListener(
    "pointerleave",
    () => {
      hover = undefined;
    },
    { signal },
  );
  button.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat && (event.key === " " || event.key === "Enter")) event.preventDefault();
      if (event.key === "Escape" && pointer) {
        releasePointer(true);
        hover = undefined;
        select(day, "cancel");
      }
    },
    { signal },
  );
  button.addEventListener("click", onClick, { signal });

  assignCells(particles, day);
  snapParticles();
  updateAttributes();
  initRenderer();
  resize();

  return {
    update(next = {}) {
      if (!active) return;
      const wasReduced = reduce();
      const layoutChanged = next.height !== options.height || next.embedded !== options.embedded;
      const checkedChanged = typeof next.checked === "boolean" && next.checked !== day;
      options = next;
      if (options.sound === false) audio.stop();
      if (checkedChanged) {
        releasePointer(true);
        select(next.checked);
      } else {
        updateAttributes();
      }
      if (!wasReduced && reduce()) onMotionChange();
      if (layoutChanged) resize();
    },
    destroy() {
      if (!active) return;
      active = false;
      controller.abort();
      observer.disconnect();
      releasePointer(true);
      view.cancelAnimationFrame(frameId);
      audio.destroy();
      renderer?.destroy();
      if (glContext && !glContext.isContextLost()) glContext.getExtension("WEBGL_lose_context")?.loseContext();
      scene.remove();
    },
  };
}
