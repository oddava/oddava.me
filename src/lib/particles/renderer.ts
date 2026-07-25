import { FLOATS_PER_MOTE } from './field';
import type { ParticlePalette } from './palette';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';

/**
 * One program, one static buffer, one draw call per frame. The renderer owns GL
 * state and nothing else: it does not know about time, presets, quality, or the
 * page — the controller feeds it a frame's worth of numbers.
 *
 * Every failure path returns null instead of throwing. A decorative background
 * that can break a page is not worth having.
 */

export interface FrameState {
  /** Seconds of drift clock. */
  readonly time: number;
  /** Motes to draw — always a prefix of the uploaded field. */
  readonly count: number;
  readonly intensity: number;
  readonly speed: number;
  readonly lift: number;
  /** Device pixels per CSS pixel, after quality scaling. */
  readonly sizeScale: number;
  /** Pointer position in device pixels. */
  readonly pointerX: number;
  readonly pointerY: number;
  readonly pointerEnergy: number;
  readonly pointerRadius: number;
  readonly pointerPush: number;
  /** Viewports scrolled. */
  readonly scroll: number;
  readonly columnHalfWidth: number;
  readonly columnStrength: number;
}

export interface ParticleRenderer {
  /** Largest point size the driver will actually rasterise. */
  readonly maxPointSize: number;
  setPalette(palette: ParticlePalette): void;
  upload(field: Float32Array): void;
  /** Sizes the backing store. Dimensions are device pixels. */
  resize(width: number, height: number): void;
  draw(frame: FrameState): void;
  dispose(): void;
}

const UNIFORM_NAMES = [
  'uResolution',
  'uTime',
  'uSpeed',
  'uLift',
  'uIntensity',
  'uSizeScale',
  'uMaxPoint',
  'uPointer',
  'uPointerEnergy',
  'uPointerRadius',
  'uPointerPush',
  'uScroll',
  'uColumn',
  'uToneFar',
  'uToneNear',
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];
type Uniforms = Partial<Record<UniformName, WebGLUniformLocation | null>>;

/** Below this a driver cannot rasterise a soft mote, and the effect would be a
 *  field of single pixels. Better to render nothing at all. */
const MIN_USABLE_POINT_SIZE = 4;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The shaders are only referenced by the linked program from here on.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  palette: ParticlePalette,
): ParticleRenderer | null {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    // No multisampling, depth or stencil: points are shaped by the fragment
    // shader, and nothing is ever occluded.
    antialias: false,
    depth: false,
    stencil: false,
    // A background has no business waking a discrete GPU.
    powerPreference: 'low-power',
    desynchronized: true,
    preserveDrawingBuffer: false,
  };
  const gl = (canvas.getContext('webgl2', attributes) ??
    canvas.getContext('webgl', attributes)) as WebGLRenderingContext | null;
  if (!gl) return null;

  const pointRange = gl.getParameter(
    gl.ALIASED_POINT_SIZE_RANGE,
  ) as Float32Array | null;
  const maxPointSize = Math.floor(pointRange?.[1] ?? 0);
  if (maxPointSize < MIN_USABLE_POINT_SIZE) return null;

  const program = link(gl);
  if (!program) return null;

  const buffer = gl.createBuffer();
  if (!buffer) {
    gl.deleteProgram(program);
    return null;
  }

  const uniforms: Uniforms = {};
  for (const name of UNIFORM_NAMES) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  const seedLocation = gl.getAttribLocation(program, 'aSeed');
  const traitLocation = gl.getAttribLocation(program, 'aTrait');

  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied source over destination: the page's own surface stays the
  // ground, and overlapping motes accumulate without clipping to white.
  gl.blendFuncSeparate(
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  );
  gl.clearColor(0, 0, 0, 0);

  let tones = palette;
  let capacity = 0;
  let width = 0;
  let height = 0;

  const stride = FLOATS_PER_MOTE * Float32Array.BYTES_PER_ELEMENT;

  return {
    maxPointSize,

    setPalette(next) {
      tones = next;
    },

    upload(field) {
      capacity = Math.floor(field.length / FLOATS_PER_MOTE);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, field, gl.STATIC_DRAW);
      if (seedLocation >= 0) {
        gl.enableVertexAttribArray(seedLocation);
        gl.vertexAttribPointer(seedLocation, 4, gl.FLOAT, false, stride, 0);
      }
      if (traitLocation >= 0) {
        gl.enableVertexAttribArray(traitLocation);
        gl.vertexAttribPointer(
          traitLocation,
          4,
          gl.FLOAT,
          false,
          stride,
          4 * Float32Array.BYTES_PER_ELEMENT,
        );
      }
    },

    resize(nextWidth, nextHeight) {
      width = Math.max(1, Math.round(nextWidth));
      height = Math.max(1, Math.round(nextHeight));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
    },

    draw(frame) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      const count = Math.min(Math.max(Math.floor(frame.count), 0), capacity);
      if (count === 0 || width === 0 || height === 0) return;

      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution ?? null, width, height);
      gl.uniform1f(uniforms.uTime ?? null, frame.time);
      gl.uniform1f(uniforms.uSpeed ?? null, frame.speed);
      gl.uniform1f(uniforms.uLift ?? null, frame.lift);
      gl.uniform1f(uniforms.uIntensity ?? null, frame.intensity);
      gl.uniform1f(uniforms.uSizeScale ?? null, frame.sizeScale);
      gl.uniform1f(uniforms.uMaxPoint ?? null, maxPointSize);
      gl.uniform2f(uniforms.uPointer ?? null, frame.pointerX, frame.pointerY);
      gl.uniform1f(uniforms.uPointerEnergy ?? null, frame.pointerEnergy);
      gl.uniform1f(uniforms.uPointerRadius ?? null, frame.pointerRadius);
      gl.uniform1f(uniforms.uPointerPush ?? null, frame.pointerPush);
      gl.uniform1f(uniforms.uScroll ?? null, frame.scroll);
      gl.uniform2f(
        uniforms.uColumn ?? null,
        frame.columnHalfWidth,
        frame.columnStrength,
      );
      gl.uniform3f(uniforms.uToneFar ?? null, ...tones.far);
      gl.uniform3f(uniforms.uToneNear ?? null, ...tones.near);

      gl.drawArrays(gl.POINTS, 0, count);
    },

    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      // Hand the backing store back rather than waiting for the canvas to be
      // collected; a lost page can otherwise hold GPU memory for a while.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
