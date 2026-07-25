import { FLOATS_PER_QUAD } from './motion';
import type { ParticlePalette } from './palette';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';

/**
 * One program, two buffers, one draw call per frame: a static buffer of per-mote
 * traits uploaded once, and a dynamic buffer of positions the simulation refills
 * each frame. The renderer owns GL state and nothing else — it does not know
 * about time, presets, quality, the pointer, or the page.
 *
 * Every failure path returns null instead of throwing. A decorative background
 * that can break a page is not worth having.
 */

export interface ParticleRenderer {
  /** Largest point size the driver will actually rasterise. */
  readonly maxPointSize: number;
  setPalette(palette: ParticlePalette): void;
  /** Per-mote traits: depth and kind, interleaved. Uploaded once. */
  uploadTraits(traits: Float32Array): void;
  /** Per-frame vertex state: x, y, diameter, alpha — all in CSS pixels. */
  uploadQuads(quads: Float32Array): void;
  /** Sizes the backing store. Dimensions are device pixels. */
  resize(width: number, height: number, pixelRatio: number): void;
  draw(count: number): void;
  dispose(): void;
}

const UNIFORM_NAMES = [
  'uResolution',
  'uPixelRatio',
  'uMaxPoint',
  'uToneFar',
  'uToneNear',
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];
type Uniforms = Partial<Record<UniformName, WebGLUniformLocation | null>>;

/** Below this a driver cannot rasterise a soft mote, and the effect would be a
 *  field of single pixels. Better to render nothing at all. */
const MIN_USABLE_POINT_SIZE = 4;

const FLOATS_PER_TRAIT = 2;

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

  const traitBuffer = gl.createBuffer();
  const quadBuffer = gl.createBuffer();
  if (!traitBuffer || !quadBuffer) {
    if (traitBuffer) gl.deleteBuffer(traitBuffer);
    if (quadBuffer) gl.deleteBuffer(quadBuffer);
    gl.deleteProgram(program);
    return null;
  }

  const uniforms: Uniforms = {};
  for (const name of UNIFORM_NAMES) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  const quadLocation = gl.getAttribLocation(program, 'aQuad');
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
  let pixelRatio = 1;

  return {
    maxPointSize,

    setPalette(next) {
      tones = next;
    },

    uploadTraits(traits) {
      gl.bindBuffer(gl.ARRAY_BUFFER, traitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, traits, gl.STATIC_DRAW);
      if (traitLocation >= 0) {
        gl.enableVertexAttribArray(traitLocation);
        gl.vertexAttribPointer(traitLocation, 2, gl.FLOAT, false, 0, 0);
      }
    },

    uploadQuads(quads) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      if (capacity !== quads.length) {
        capacity = quads.length;
        gl.bufferData(gl.ARRAY_BUFFER, quads, gl.DYNAMIC_DRAW);
      } else {
        // Orphan-free respecify of a buffer that is the same size every frame:
        // a few kilobytes, well inside what a driver streams without stalling.
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, quads);
      }
      if (quadLocation >= 0) {
        gl.enableVertexAttribArray(quadLocation);
        gl.vertexAttribPointer(quadLocation, 4, gl.FLOAT, false, 0, 0);
      }
    },

    resize(nextWidth, nextHeight, nextPixelRatio) {
      width = Math.max(1, Math.round(nextWidth));
      height = Math.max(1, Math.round(nextHeight));
      pixelRatio = nextPixelRatio;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
    },

    draw(count) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      const motes = Math.min(
        Math.max(Math.floor(count), 0),
        capacity / FLOATS_PER_QUAD,
      );
      if (motes === 0 || width === 0 || height === 0) return;

      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution ?? null, width, height);
      gl.uniform1f(uniforms.uPixelRatio ?? null, pixelRatio);
      gl.uniform1f(uniforms.uMaxPoint ?? null, maxPointSize);
      gl.uniform3f(uniforms.uToneFar ?? null, ...tones.far);
      gl.uniform3f(uniforms.uToneNear ?? null, ...tones.near);

      gl.drawArrays(gl.POINTS, 0, motes);
    },

    dispose() {
      gl.deleteBuffer(traitBuffer);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
      // Hand the backing store back rather than waiting for the canvas to be
      // collected; a lost page can otherwise hold GPU memory for a while.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** Extracts the static per-vertex traits (depth, kind) from a generated field. */
export function traitsFromField(
  field: Float32Array,
  floatsPerMote: number,
): Float32Array {
  const count = Math.floor(field.length / floatsPerMote);
  const traits = new Float32Array(count * FLOATS_PER_TRAIT);
  for (let index = 0; index < count; index += 1) {
    traits[index * FLOATS_PER_TRAIT] = field[index * floatsPerMote + 4]!;
    traits[index * FLOATS_PER_TRAIT + 1] = field[index * floatsPerMote + 6]!;
  }
  return traits;
}
