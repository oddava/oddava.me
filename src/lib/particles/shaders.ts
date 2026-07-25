/**
 * GLSL ES 1.00 so one source pair runs on a WebGL 2 or a WebGL 1 context.
 *
 * The shaders know nothing about motion, time, or the cursor. Positions arrive
 * already integrated (see `motion.ts`), which is deliberate: forces need
 * positions, so the simulation has to own them, and duplicating the motion in
 * GLSL would mean two implementations that could disagree by a frame.
 *
 * What is left is what a GPU is actually for — rasterising a few hundred soft
 * sprites in one draw call.
 */

export const VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec4 aQuad;   // x, y (css px, y down), diameter (css px), alpha
attribute vec2 aTrait;  // depth, kind (0 dust / 1 drafting tick)

uniform vec2 uResolution;   // device pixels
uniform float uPixelRatio;
uniform float uMaxPoint;    // driver's largest usable point size
uniform vec3 uToneFar;
uniform vec3 uToneNear;

varying vec4 vColor;
varying vec2 vShape;        // kind, falloff exponent

void main() {
  vec2 device = aQuad.xy * uPixelRatio;
  gl_Position = vec4(
    device.x / uResolution.x * 2.0 - 1.0,
    1.0 - device.y / uResolution.y * 2.0,
    0.0,
    1.0
  );
  gl_PointSize = min(aQuad.z * uPixelRatio, uMaxPoint);

  // Depth is the whole palette: far specks are graphite and tight, near motes
  // are brand-tinted and soft, because they are the ones out of focus.
  vColor = vec4(mix(uToneFar, uToneNear, aTrait.x), aQuad.w);
  vShape = vec2(aTrait.y, mix(1.45, 0.7, aTrait.x));
}
`;

export const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 vColor;
varying vec2 vShape;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float radius = length(q);

  // Dust: a soft radial falloff whose exponent comes from depth.
  float dust = pow(max(1.0 - radius, 0.0), vShape.y);

  // Ticks: the same small cross that marks the grid on the notes landscape. A
  // few of these per screen are what tie the field to the drafting language
  // instead of to a generic starfield.
  float arm = max(
    (1.0 - smoothstep(0.06, 0.3, abs(q.x))) * (1.0 - smoothstep(0.55, 0.95, abs(q.y))),
    (1.0 - smoothstep(0.06, 0.3, abs(q.y))) * (1.0 - smoothstep(0.55, 0.95, abs(q.x)))
  );

  float mask = mix(dust, arm * 0.85, vShape.x);
  // Premultiplied: the canvas composites over the page, so the ground stays the
  // page's own surface colour and overlapping motes cannot blow out to white.
  gl_FragColor = vec4(vColor.rgb * vColor.a * mask, vColor.a * mask);
}
`;
