// Post-processing for stream frames, on a page canvas or, for PlayStation, inside
// the media worker on an OffscreenCanvas:
//   1. debanding: smooths the steps a video codec leaves in dark, flat gradients
//   2. scaling: AMD FidelityFX Super Resolution 1.0 (MIT) EASU, or bilinear
//   3. sharpening: FSR 1.0 RCAS
// The last pass dithers, so a smoothed gradient does not band again at 8 bits.

import { t } from '../../../shared/i18n'

export type Fit = 'contain' | 'cover' | 'fill'

export interface Size {
  width: number
  height: number
}

export interface PictureOptions {
  fsr: boolean
  /** 0 turns sharpening off; 10 is the strongest. Only used with FSR. */
  sharpness: number
  deband: boolean
}

/** What the stats line says is running, or '' when nothing is. */
export const pictureLabel = (o: PictureOptions) => [o.fsr && 'FSR', o.deband && t('bant giderme')].filter(Boolean).join(' · ')

// Picture formats with a fixed ratio size their own box, so the frame fills it.
export const fitFor = (videoFormat: string): Fit => (videoFormat === 'Zoom' ? 'cover' : videoFormat === '' ? 'contain' : 'fill')

// The pixel size the frame covers on screen, so the canvas is drawn 1:1 and CSS never rescales it.
export function outputSize(box: Size, frame: Size, fit: Fit): Size {
  if (fit === 'fill') return { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) }
  const pick = fit === 'cover' ? Math.max : Math.min
  const scale = pick(box.width / frame.width, box.height / frame.height)
  return { width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)) }
}

const DEBAND_THRESHOLD = 2 / 255
const DEBAND_RADIUS = 24
const DEBAND_ROUNDS = 4

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D src;
uniform float seed;
out vec4 color;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031 + seed);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`

// Triangular noise of one 8-bit step, so the final quantisation leaves no bands.
const DITHER = `
uniform float dither;
vec3 dithered(vec3 c) {
  float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 17.0) - 1.0;
  return c + dither * n / 255.0;
}
`

// One triangle that covers the whole target; no vertex buffers needed.
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// Writes at the source size and keeps its orientation: row 0 stays the top row.
const DEBAND = `${HEADER}
uniform float threshold;
uniform float radius;
ivec2 size;

vec3 at(vec2 p) {
  return texelFetch(src, clamp(ivec2(p), ivec2(0), size - 1), 0).rgb;
}

void main() {
  size = textureSize(src, 0);
  vec2 p = floor(gl_FragCoord.xy);
  vec3 c = at(p);
  // Average ever wider rings of random points; stop at the first ring that sees real detail.
  for (int i = 1; i <= ${DEBAND_ROUNDS}; i++) {
    float r = radius * float(i) / float(${DEBAND_ROUNDS}) * (0.5 + 0.5 * hash(p + float(i) * 7.0));
    float a = 6.2831853 * hash(p.yx + float(i) * 13.0);
    vec2 o = vec2(cos(a), sin(a)) * r;
    vec3 avg = 0.25 * (at(p + o) + at(p - o) + at(p + vec2(-o.y, o.x)) + at(p + vec2(o.y, -o.x)));
    vec3 d = abs(c - avg);
    if (max(d.r, max(d.g, d.b)) >= threshold) break;
    c = avg;
  }
  color = vec4(c, 1.0);
}`

// Plain bilinear. Source row 0 is the top.
const COPY = `${HEADER}${DITHER}
uniform vec2 outSize;
void main() {
  vec2 uv = vec2(gl_FragCoord.x, outSize.y - gl_FragCoord.y) / outSize;
  color = vec4(dithered(texture(src, uv).rgb), 1.0);
}`

const EASU = `${HEADER}${DITHER}
uniform vec2 outSize;
uniform vec4 con0; // xy: output to input scale, zw: offset to the input pixel centre
ivec2 size;

vec3 tap(ivec2 p) {
  return texelFetch(src, clamp(p, ivec2(0), size - 1), 0).rgb;
}

float luma(vec3 c) {
  return c.g + 0.5 * (c.r + c.b);
}

void setDir(inout vec2 dir, inout float len, float w, float a, float b, float c, float d, float e) {
  float lenX = max(abs(d - c), abs(c - b));
  float dirX = d - b;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) / max(lenX, 1.0 / 65536.0), 0.0, 1.0);
  len += lenX * lenX * w;

  float lenY = max(abs(e - c), abs(c - a));
  float dirY = e - a;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) / max(lenY, 1.0 / 65536.0), 0.0, 1.0);
  len += lenY * lenY * w;
}

void addTap(inout vec3 sum, inout float weight, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  sum += c * w;
  weight += w;
}

void main() {
  size = textureSize(src, 0);
  vec2 ip = vec2(floor(gl_FragCoord.x), outSize.y - 1.0 - floor(gl_FragCoord.y));
  vec2 pp = ip * con0.xy + con0.zw;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 f0 = ivec2(fp);

  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 b = tap(f0 + ivec2(0, -1)), c = tap(f0 + ivec2(1, -1));
  vec3 e = tap(f0 + ivec2(-1, 0)), f = tap(f0), g = tap(f0 + ivec2(1, 0)), h = tap(f0 + ivec2(2, 0));
  vec3 i = tap(f0 + ivec2(-1, 1)), j = tap(f0 + ivec2(0, 1)), k = tap(f0 + ivec2(1, 1)), l = tap(f0 + ivec2(2, 1));
  vec3 n = tap(f0 + ivec2(0, 2)), o = tap(f0 + ivec2(1, 2));
  float bL = luma(b), cL = luma(c), eL = luma(e), fL = luma(f), gL = luma(g), hL = luma(h);
  float iL = luma(i), jL = luma(j), kL = luma(k), lL = luma(l), nL = luma(n), oL = luma(o);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  setDir(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  setDir(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  setDir(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  setDir(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

  float dirR = dot(dir, dir);
  bool still = dirR < 1.0 / 32768.0;
  dir = still ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);
  len *= 0.5;
  len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 - 0.29 * len;
  float clp = 1.0 / lob;

  vec3 sum = vec3(0.0);
  float weight = 0.0;
  addTap(sum, weight, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  addTap(sum, weight, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  addTap(sum, weight, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  addTap(sum, weight, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  addTap(sum, weight, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  addTap(sum, weight, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  addTap(sum, weight, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  addTap(sum, weight, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  addTap(sum, weight, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  addTap(sum, weight, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  addTap(sum, weight, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  addTap(sum, weight, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);

  // Clamp to the four nearest pixels so the kernel's negative lobe cannot ring.
  vec3 lo = min(min(f, g), min(j, k));
  vec3 hi = max(max(f, g), max(j, k));
  color = vec4(dithered(clamp(sum / weight, lo, hi)), 1.0);
}`

const RCAS = `${HEADER}${DITHER}
uniform float con; // 1.0 is the strongest sharpening, each halving one stop weaker
ivec2 size;

vec3 at(ivec2 p) {
  return texelFetch(src, clamp(p, ivec2(0), size - 1), 0).rgb;
}

void main() {
  size = textureSize(src, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = at(p + ivec2(0, 1)), d = at(p + ivec2(-1, 0)), e = at(p), f = at(p + ivec2(1, 0)), h = at(p + ivec2(0, -1));
  vec3 mn = min(min(b, d), min(f, h));
  vec3 mx = max(max(b, d), max(f, h));
  // How far the ring may push before a channel clips at 0 or 1.
  vec3 hitMin = mn / max(4.0 * mx, vec3(1.0 / 65536.0));
  vec3 hitMax = (1.0 - mx) / min(4.0 * mn - 4.0, vec3(-1.0 / 65536.0));
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-(0.25 - 1.0 / 16.0), min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * con;
  color = vec4(dithered((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0)), 1.0);
}`

type Gl = WebGL2RenderingContext

interface Target {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  size: Size
}

function program(gl: Gl, fragment: string) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
    return shader
  }
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program')
  return p
}

function texture(gl: Gl) {
  const t = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

export class Picture {
  options: PictureOptions = { fsr: true, sharpness: 5, deband: false }

  private copy!: WebGLProgram
  private easu!: WebGLProgram
  private rcas!: WebGLProgram
  private deband!: WebGLProgram
  private source!: WebGLTexture
  private smooth!: Target
  private middle!: Target
  // Half floats keep the in-between shades that debanding creates, when the GPU can render to them.
  private precise = false
  private frame = 0
  private lost = false

  private constructor(private gl: Gl, private canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.setup()
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.setup()
      this.lost = false
    })
  }

  static create(canvas: HTMLCanvasElement | OffscreenCanvas, options?: PictureOptions) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    }) as Gl | null
    if (!gl) return undefined
    try {
      const picture = new Picture(gl, canvas)
      if (options) picture.options = options
      return picture
    } catch {
      return undefined
    }
  }

  private setup() {
    const gl = this.gl
    this.precise = gl.getExtension('EXT_color_buffer_float') !== null
    this.copy = program(gl, COPY)
    this.easu = program(gl, EASU)
    this.rcas = program(gl, RCAS)
    this.deband = program(gl, DEBAND)
    this.source = texture(gl)
    this.smooth = { texture: texture(gl), framebuffer: gl.createFramebuffer()!, size: { width: 0, height: 0 } }
    this.middle = { texture: texture(gl), framebuffer: gl.createFramebuffer()!, size: { width: 0, height: 0 } }
    gl.bindVertexArray(gl.createVertexArray())
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
  }

  private bindTarget(target: Target | null, size: Size) {
    const gl = this.gl
    if (target) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
      if (target.size.width !== size.width || target.size.height !== size.height) {
        const format = this.precise ? gl.RGBA16F : gl.RGBA8
        const type = this.precise ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
        gl.texImage2D(gl.TEXTURE_2D, 0, format, size.width, size.height, 0, gl.RGBA, type, null)
        target.size = size
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0)
    } else gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, size.width, size.height)
  }

  private run(p: WebGLProgram, input: WebGLTexture, uniforms: (at: (name: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl
    gl.useProgram(p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    const at = (name: string) => gl.getUniformLocation(p, name)
    gl.uniform1i(at('src'), 0)
    gl.uniform1f(at('seed'), (this.frame % 64) * 0.618)
    uniforms(at)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Draws one frame scaled to the canvas's current size. */
  draw(frame: TexImageSource, width: number, height: number) {
    const gl = this.gl
    if (this.lost || gl.isContextLost()) return
    const { fsr, sharpness, deband } = this.options
    const out = { width: this.canvas.width, height: this.canvas.height }
    this.frame++

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.source)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
    let input = this.source

    if (deband) {
      this.bindTarget(this.smooth, { width, height })
      this.run(this.deband, input, (at) => {
        gl.uniform1f(at('threshold'), DEBAND_THRESHOLD)
        gl.uniform1f(at('radius'), DEBAND_RADIUS)
      })
      input = this.smooth.texture
    }

    const upscale = fsr && (out.width > width || out.height > height)
    const sharpen = fsr && sharpness > 0
    // Only the pass that writes the screen dithers; debanding is pointless without it.
    const ditherLast = deband ? 1 : 0

    this.bindTarget(sharpen ? this.middle : null, out)
    this.run(upscale ? this.easu : this.copy, input, (at) => {
      gl.uniform2f(at('outSize'), out.width, out.height)
      gl.uniform1f(at('dither'), sharpen ? 0 : ditherLast)
      if (upscale) {
        const sx = width / out.width
        const sy = height / out.height
        gl.uniform4f(at('con0'), sx, sy, 0.5 * sx - 0.5, 0.5 * sy - 0.5)
      }
    })

    if (!sharpen) return
    this.bindTarget(null, out)
    this.run(this.rcas, this.middle.texture, (at) => {
      gl.uniform1f(at('dither'), ditherLast)
      // Level 10 is RCAS at full strength; each step below it takes a fifth of a stop off.
      gl.uniform1f(at('con'), 2 ** (-(10 - Math.min(10, sharpness)) * 0.2))
    })
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
