import { coverTransform, type AffinePart, type Backend, type BackgroundParams, type QuadDraw, type RenderTarget, type SpriteDraw, type Tex } from './backend';

/**
 * WebGL-рендерер арены. Персонажи рисуются как деформируемая сетка (дыхание, колыхание плаща,
 * наклон, сжатие/растяжение), а не как плоские прямоугольники. Альфа — premultiplied.
 */

const GRID_X = 12;
const GRID_Y = 28;

const SPRITE_VS = `
precision highp float;
attribute vec2 a_uv;
uniform vec2 u_res, u_pos, u_size, u_scale;
uniform vec4 u_uvRect;
uniform float u_flip, u_time, u_phase, u_breath, u_sway, u_bob, u_lean, u_rot, u_mode;
varying vec2 v_uv;
varying vec2 v_luv;
varying float v_hf;
void main() {
  float hf = 1.0 - a_uv.y;
  float t = u_time + u_phase;
  float x = (a_uv.x - 0.5) * u_size.x;
  float y = -hf * u_size.y;
  float br = sin(t * 1.9);
  float chest = exp(-pow((hf - 0.62) / 0.22, 2.0));
  x *= 1.0 + u_breath * 0.55 * br * chest;
  y *= 1.0 + u_breath * br * smoothstep(0.1, 0.9, hf);
  float side = smoothstep(0.1, 0.48, abs(a_uv.x - 0.5));
  float low = smoothstep(0.02, 0.14, hf) * (1.0 - smoothstep(0.42, 0.8, hf));
  x += u_sway * u_size.x * 0.035 * sin(t * 1.35 + a_uv.y * 4.5 + a_uv.x * 2.3) * side * low;
  x += u_sway * u_size.x * 0.012 * sin(t * 0.9 + a_uv.y * 2.0) * smoothstep(0.3, 0.9, hf);
  y += u_bob * u_size.y * 0.007 * sin(t * 1.9 - 0.6) * smoothstep(0.65, 0.95, hf);
  x += u_lean * hf * u_size.y;
  x *= u_flip;
  x *= u_scale.x;
  y *= u_scale.y;
  if (u_mode > 0.5 && u_mode < 1.5) {
    y = -y * 0.85;
    x += sin(y * 0.09 + u_time * 2.2) * 2.5;
  } else if (u_mode > 1.5) {
    float hgt = -y;
    x += hgt * 0.42;
    y = hgt * 0.13;
  }
  float c = cos(u_rot), s = sin(u_rot);
  vec2 p = vec2(c * x - s * y, s * x + c * y) + u_pos;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_uv);
  v_luv = a_uv;
  v_hf = hf;
}`;

const SPRITE_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
varying vec2 v_luv;
varying float v_hf;
uniform sampler2D u_tex, u_emi, u_noise;
uniform vec2 u_texel;
uniform vec3 u_tint, u_flashC, u_emiC, u_rimC, u_outC;
uniform float u_alpha, u_flash, u_dissolve, u_desat, u_emiS, u_rim, u_outline, u_ftime, u_mode, u_hasEmi;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  vec3 col = c.rgb;
  float a = c.a;
  if (u_mode > 1.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.55 * u_alpha);
    return;
  }
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(lum), u_desat);
  col *= u_tint;
  // Затенение к ступням: фигура «садится» в туман и пол сцены.
  col *= mix(0.5, 1.0, smoothstep(0.0, 0.32, v_hf));
  float edge = clamp(a - texture2D(u_tex, v_uv + vec2(-u_texel.x * 5.0, -u_texel.y * 3.0)).a, 0.0, 1.0);
  float edge2 = clamp(a - texture2D(u_tex, v_uv + vec2(u_texel.x * 5.0, -u_texel.y * 2.0)).a, 0.0, 1.0);
  col += u_rimC * (edge * 0.9 + edge2 * 0.35) * u_rim;
  if (u_hasEmi > 0.5) {
    float e = texture2D(u_emi, v_uv).a;
    float pulse = 0.72 + 0.28 * sin(u_ftime * 3.1 + v_uv.y * 14.0) + 0.15 * sin(u_ftime * 7.3 + v_uv.x * 9.0);
    col += u_emiC * e * u_emiS * pulse * a;
  }
  col = mix(col, u_flashC * a, u_flash);
  if (u_dissolve > 0.0) {
    float n = texture2D(u_noise, v_luv * vec2(1.6, 2.4)).r * 0.82 + v_hf * 0.18;
    if (n < u_dissolve) discard;
    float edgeD = smoothstep(u_dissolve, u_dissolve + 0.07, n);
    col = mix(vec3(1.6, 0.62, 0.18) * a, col, edgeD);
  }
  float alpha = u_alpha;
  if (u_mode > 0.5) {
    alpha *= 0.26 * clamp(1.0 - v_hf * 1.6, 0.0, 1.0);
  }
  vec4 outc = vec4(col * alpha, a * alpha);
  if (u_outline > 0.0 && u_mode < 0.5) {
    float o = 0.0;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.785398;
      o = max(o, texture2D(u_tex, v_uv + vec2(cos(ang), sin(ang)) * u_texel * 4.0).a);
    }
    float ring = clamp(o - a, 0.0, 1.0) * u_outline;
    outc += vec4(u_outC * ring, ring);
  }
  gl_FragColor = outc;
}`;

const BG_VS = `
attribute vec2 a_p;
varying vec2 v_p;
void main() { v_p = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }`;

const BG_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_p;
uniform sampler2D u_bg, u_noise;
uniform vec2 u_res, u_tex, u_off;
uniform float u_zoom, u_time, u_fog, u_vig, u_contrast, u_sat, u_bright;
uniform vec3 u_tint, u_fogC;
void main() {
  vec2 sp = vec2(v_p.x, 1.0 - v_p.y);
  float scale = max(u_res.x / u_tex.x, u_res.y / u_tex.y) * u_zoom;
  vec2 drawn = u_tex * scale;
  vec2 uv = (sp * u_res - (u_res - drawn) * 0.5) / drawn + u_off;
  vec3 c = texture2D(u_bg, uv).rgb;
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(l), c, u_sat);
  c = (c - 0.5) * u_contrast + 0.5;
  c *= u_bright * u_tint;
  float n = texture2D(u_noise, sp * vec2(1.3, 0.7) + vec2(u_time * 0.012, u_time * 0.002)).r * 0.6
          + texture2D(u_noise, sp * vec2(2.6, 1.4) - vec2(u_time * 0.021, 0.0)).r * 0.4;
  float band = smoothstep(0.42, 1.0, sp.y) * 0.85 + 0.15;
  c = mix(c, u_fogC, clamp(u_fog * band * (n * 1.3 - 0.15), 0.0, 1.0));
  vec2 d = sp - vec2(0.5, 0.55);
  c *= clamp(1.0 - u_vig * dot(d, d) * 1.7, 0.0, 1.0);
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

const QUAD_VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute vec4 a_col;
uniform vec2 u_res;
uniform float u_yflip;
varying vec2 v_uv;
varying vec4 v_col;
void main() {
  vec2 clip = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, clip.y * u_yflip, 0.0, 1.0);
  v_uv = a_uv;
  v_col = a_col;
}`;

const QUAD_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
varying vec4 v_col;
uniform sampler2D u_tex;
uniform float u_additive;
void main() {
  vec4 t = texture2D(u_tex, v_uv);
  vec4 c = t * v_col;
  // premultiplied: при аддитивном смешении альфа не закрывает фон
  gl_FragColor = vec4(c.rgb * v_col.a, u_additive > 0.5 ? 0.0 : c.a);
}`;

type Uniforms = Record<string, WebGLUniformLocation | null>;

function compile(gl: WebGLRenderingContext, vs: string, fs: string): { prog: WebGLProgram; u: Uniforms; attr: (n: string) => number } {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type) as WebGLShader;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Шейдер: ${gl.getShaderInfoLog(sh) ?? ''}`);
    return sh;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(prog, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Программа: ${gl.getProgramInfoLog(prog) ?? ''}`);
  const cache: Uniforms = {};
  const u = new Proxy(cache, {
    get(target, name: string) {
      if (!(name in target)) target[name] = gl.getUniformLocation(prog, name);
      return target[name];
    },
  });
  return { prog, u, attr: (n) => gl.getAttribLocation(prog, n) };
}

export class WebGLBackend implements Backend {
  readonly kind = 'webgl' as const;
  private gl: WebGLRenderingContext;
  private sprite;
  private bg;
  private quad;
  private gridBuf: WebGLBuffer;
  private gridIdx: WebGLBuffer;
  private gridCount: number;
  private fsBuf: WebGLBuffer;
  private quadBuf: WebGLBuffer;
  private quadData = new Float32Array(6 * 8 * 2048);
  private noise: Tex;
  private white: Tex;
  private w = 1;
  private h = 1;
  /** Размер текущей цели рендера (null — экран). */
  private targetW: number | null = null;
  private targetH: number | null = null;
  private fbos = new Map<Tex, WebGLFramebuffer>();

  constructor(private canvas: HTMLCanvasElement, noiseCanvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: true, preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL недоступен');
    this.gl = gl;
    this.sprite = compile(gl, SPRITE_VS, SPRITE_FS);
    this.bg = compile(gl, BG_VS, BG_FS);
    this.quad = compile(gl, QUAD_VS, QUAD_FS);

    const verts: number[] = [];
    for (let j = 0; j <= GRID_Y; j++) for (let i = 0; i <= GRID_X; i++) verts.push(i / GRID_X, j / GRID_Y);
    const idx: number[] = [];
    for (let j = 0; j < GRID_Y; j++) {
      for (let i = 0; i < GRID_X; i++) {
        const a = j * (GRID_X + 1) + i;
        const b = a + 1;
        const c = a + GRID_X + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.gridBuf = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    this.gridIdx = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.gridCount = idx.length;

    this.fsBuf = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.quadBuf = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadData.byteLength, gl.DYNAMIC_DRAW);

    this.noise = this.createTexture(noiseCanvas, noiseCanvas.width, noiseCanvas.height, true);
    const w = document.createElement('canvas');
    w.width = 2;
    w.height = 2;
    const wc = w.getContext('2d') as CanvasRenderingContext2D;
    wc.fillStyle = '#fff';
    wc.fillRect(0, 0, 2, 2);
    this.white = this.createTexture(w, 2, 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  createTexture(source: TexImageSource & CanvasImageSource, w: number, h: number, repeat = false): Tex {
    const gl = this.gl;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const pot = (n: number) => (n & (n - 1)) === 0;
    const mip = pot(w) && pot(h);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat && mip ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return { w, h, handle: t, source };
  }

  begin(): void {
    const gl = this.gl;
    gl.clearColor(0.03, 0.035, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private bindTex(unit: number, tex: Tex): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex.handle as WebGLTexture);
  }

  drawBackground(tex: Tex, p: BackgroundParams): void {
    const gl = this.gl;
    const { prog, u, attr } = this.bg;
    gl.useProgram(prog);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsBuf);
    const loc = attr('a_p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.bindTex(0, tex);
    this.bindTex(1, this.noise);
    gl.uniform1i(u.u_bg as WebGLUniformLocation, 0);
    gl.uniform1i(u.u_noise as WebGLUniformLocation, 1);
    gl.uniform2f(u.u_res as WebGLUniformLocation, this.w, this.h);
    gl.uniform2f(u.u_tex as WebGLUniformLocation, tex.w, tex.h);
    gl.uniform2f(u.u_off as WebGLUniformLocation, p.offsetX, p.offsetY);
    gl.uniform1f(u.u_zoom as WebGLUniformLocation, p.zoom);
    gl.uniform1f(u.u_time as WebGLUniformLocation, p.time);
    gl.uniform1f(u.u_fog as WebGLUniformLocation, p.fog);
    gl.uniform1f(u.u_vig as WebGLUniformLocation, p.vignette);
    gl.uniform1f(u.u_contrast as WebGLUniformLocation, p.contrast);
    gl.uniform1f(u.u_sat as WebGLUniformLocation, p.saturation);
    gl.uniform1f(u.u_bright as WebGLUniformLocation, p.brightness);
    gl.uniform3fv(u.u_tint as WebGLUniformLocation, p.tint);
    gl.uniform3fv(u.u_fogC as WebGLUniformLocation, p.fogColor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
    gl.enable(gl.BLEND);
  }

  drawSprite(d: SpriteDraw): void {
    const gl = this.gl;
    const { prog, u, attr } = this.sprite;
    gl.useProgram(prog);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.gridIdx);
    const loc = attr('a_uv');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.bindTex(0, d.tex);
    this.bindTex(1, d.emissive ?? this.white);
    this.bindTex(2, this.noise);
    gl.uniform1i(u.u_tex as WebGLUniformLocation, 0);
    gl.uniform1i(u.u_emi as WebGLUniformLocation, 1);
    gl.uniform1i(u.u_noise as WebGLUniformLocation, 2);
    gl.uniform2f(u.u_res as WebGLUniformLocation, this.w, this.h);
    gl.uniform2f(u.u_pos as WebGLUniformLocation, d.x, d.y);
    gl.uniform2f(u.u_size as WebGLUniformLocation, d.w, d.h);
    gl.uniform2f(u.u_scale as WebGLUniformLocation, d.sx, d.sy);
    gl.uniform4f(u.u_uvRect as WebGLUniformLocation, d.uv[0], d.uv[1], d.uv[2], d.uv[3]);
    gl.uniform2f(u.u_texel as WebGLUniformLocation, 1 / d.tex.w, 1 / d.tex.h);
    gl.uniform1f(u.u_flip as WebGLUniformLocation, d.flip ? -1 : 1);
    gl.uniform1f(u.u_time as WebGLUniformLocation, d.time);
    gl.uniform1f(u.u_ftime as WebGLUniformLocation, d.time);
    gl.uniform1f(u.u_phase as WebGLUniformLocation, d.phase);
    gl.uniform1f(u.u_breath as WebGLUniformLocation, d.breath);
    gl.uniform1f(u.u_sway as WebGLUniformLocation, d.sway);
    gl.uniform1f(u.u_bob as WebGLUniformLocation, d.bob);
    gl.uniform1f(u.u_lean as WebGLUniformLocation, d.lean);
    gl.uniform1f(u.u_rot as WebGLUniformLocation, d.rot);
    gl.uniform1f(u.u_mode as WebGLUniformLocation, d.mode);
    gl.uniform3fv(u.u_tint as WebGLUniformLocation, d.tint);
    gl.uniform3fv(u.u_flashC as WebGLUniformLocation, d.flashColor);
    gl.uniform3fv(u.u_emiC as WebGLUniformLocation, d.emissiveColor);
    gl.uniform3fv(u.u_rimC as WebGLUniformLocation, d.rimColor);
    gl.uniform3fv(u.u_outC as WebGLUniformLocation, d.outlineColor);
    gl.uniform1f(u.u_alpha as WebGLUniformLocation, d.alpha);
    gl.uniform1f(u.u_flash as WebGLUniformLocation, d.flash);
    gl.uniform1f(u.u_dissolve as WebGLUniformLocation, d.dissolve);
    gl.uniform1f(u.u_desat as WebGLUniformLocation, d.desat);
    gl.uniform1f(u.u_emiS as WebGLUniformLocation, d.emissiveStrength);
    gl.uniform1f(u.u_hasEmi as WebGLUniformLocation, d.emissive ? 1 : 0);
    gl.uniform1f(u.u_rim as WebGLUniformLocation, d.rim);
    gl.uniform1f(u.u_outline as WebGLUniformLocation, d.outline);
    gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(loc);
  }

  drawQuads(tex: Tex, quads: QuadDraw[]): void {
    if (quads.length === 0) return;
    const gl = this.gl;
    const { prog, u, attr } = this.quad;
    gl.useProgram(prog);
    this.bindTex(0, tex);
    gl.uniform1i(u.u_tex as WebGLUniformLocation, 0);
    gl.uniform2f(u.u_res as WebGLUniformLocation, this.targetW ?? this.w, this.targetH ?? this.h);
    gl.uniform1f(u.u_yflip as WebGLUniformLocation, this.targetW ? 1 : -1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const pos = attr('a_pos');
    const uvl = attr('a_uv');
    const col = attr('a_col');
    gl.enableVertexAttribArray(pos);
    gl.enableVertexAttribArray(uvl);
    gl.enableVertexAttribArray(col);
    const stride = 8 * 4;
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(uvl, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, stride, 16);
    // Аддитивные и обычные кванты рисуются двумя проходами (premultiplied: альфа 0 = аддитивно).
    for (const additive of [false, true]) {
      const list = quads.filter((q) => q.additive === additive);
      for (let start = 0; start < list.length; start += 2048) {
        const chunk = list.slice(start, start + 2048);
        let o = 0;
        const data = this.quadData;
        for (const q of chunk) {
          const c = Math.cos(q.rot);
          const s = Math.sin(q.rot);
          const hw = q.w / 2;
          const hh = q.h / 2;
          const [u0, v0, u1, v1] = q.uv;
          // Готовые углы (риг) или прямоугольник с поворотом вокруг центра.
          const k = q.corners;
          const K = (i: number) => (k?.[i] ?? 0);
          const pts: Array<[number, number, number, number]> = k
            ? [[K(0), K(1), u0, v0], [K(2), K(3), u1, v0], [K(6), K(7), u0, v1], [K(2), K(3), u1, v0], [K(4), K(5), u1, v1], [K(6), K(7), u0, v1]]
            : ([[-hw, -hh, u0, v0], [hw, -hh, u1, v0], [-hw, hh, u0, v1], [hw, -hh, u1, v0], [hw, hh, u1, v1], [-hw, hh, u0, v1]] as Array<[number, number, number, number]>).map(
                ([lx, ly, uu, vv]) => [q.x + lx * c - ly * s, q.y + lx * s + ly * c, uu, vv] as [number, number, number, number],
              );
          for (const [px, py, uu, vv] of pts) {
            data[o++] = px;
            data[o++] = py;
            data[o++] = uu;
            data[o++] = vv;
            data[o++] = q.r;
            data[o++] = q.g;
            data[o++] = q.b;
            data[o++] = q.a;
          }
        }
        gl.uniform1f(u.u_additive as WebGLUniformLocation, additive ? 1 : 0);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, o));
        gl.drawArrays(gl.TRIANGLES, 0, o / 8);
      }
    }
    gl.disableVertexAttribArray(pos);
    gl.disableVertexAttribArray(uvl);
    gl.disableVertexAttribArray(col);
  }

  createTarget(w: number, h: number): RenderTarget {
    const gl = this.gl;
    const t = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const canvasStub = document.createElement('canvas');
    const tex: Tex = { w, h, handle: t, source: canvasStub };
    this.fbos.set(tex, fb);
    return { tex, w, h };
  }

  drawRig(target: RenderTarget, atlas: Tex, parts: AffinePart[]): void {
    const gl = this.gl;
    const fb = this.fbos.get(target.tex);
    if (!fb) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.targetW = target.w;
    this.targetH = target.h;
    const quads: QuadDraw[] = [];
    // Части рисуются через батч квадов: четыре угла считаются на CPU по аффинной матрице.
    for (const p of parts) quads.push({ x: 0, y: 0, w: 0, h: 0, rot: 0, r: 1, g: 1, b: 1, a: p.alpha, uv: p.uv, additive: false, corners: corners(p) });
    this.drawQuads(atlas, quads);
    this.targetW = null;
    this.targetH = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
  }

  disposeTarget(target: RenderTarget): void {
    const fb = this.fbos.get(target.tex);
    if (fb) this.gl.deleteFramebuffer(fb);
    this.gl.deleteTexture(target.tex.handle as WebGLTexture);
    this.fbos.delete(target.tex);
  }

  overlay(r: number, g: number, b: number, a: number, additive: boolean): void {
    if (a <= 0) return;
    this.drawQuads(this.white, [{ x: this.w / 2, y: this.h / 2, w: this.w, h: this.h, rot: 0, r, g, b, a, uv: [0, 0, 1, 1], additive }]);
  }

  end(): void {
    this.gl.flush();
  }

  destroy(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }

  /** Точка на фоне → экран; используется сценой для огней. */
  cover(tex: Tex, zoom: number, offX: number, offY: number) {
    return coverTransform(this.w, this.h, tex.w, tex.h, zoom, offX, offY);
  }
}

/** Углы части рига (по часовой: лево-верх, право-верх, право-низ, лево-низ). */
function corners(p: AffinePart): number[] {
  const m = p.m;
  const at = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return [...at(p.x0, p.y0), ...at(p.x0 + p.w, p.y0), ...at(p.x0 + p.w, p.y0 + p.h), ...at(p.x0, p.y0 + p.h)];
}
