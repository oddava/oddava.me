/**
 * GLSL ES 1.00 so one source pair runs on a WebGL 2 or a WebGL 1 context.
 *
 * Every mote's path is analytic: position is a function of its seed and the
 * clock, evaluated on the GPU. Nothing is integrated, so there is no state to
 * keep, no buffer to re-upload, and a dropped or throttled frame costs continuity
 * rather than accuracy.
 */

export const VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec4 aSeed;   // x, y, phase, speed jitter
attribute vec4 aTrait;  // depth, size (css px), kind (0 dust / 1 tick), shimmer phase

uniform vec2 uResolution;      // device pixels
uniform float uTime;           // seconds
uniform float uSpeed;
uniform float uLift;
uniform float uIntensity;
uniform float uSizeScale;      // device pixels per css pixel, after quality scaling
uniform float uMaxPoint;       // driver's largest usable point size
uniform vec2 uPointer;         // device pixels
uniform float uPointerEnergy;  // 0 at rest, ~1 while moving, higher on a press
uniform float uPointerRadius;  // device pixels
uniform float uPointerPush;    // device pixels
uniform float uScroll;         // viewports scrolled
uniform vec2 uColumn;          // x: half width of the reading column, y: strength
uniform vec3 uToneFar;
uniform vec3 uToneNear;

varying vec4 vColor;
varying vec2 vShape;           // kind, falloff exponent

const float TAU = 6.2831853;

void main() {
  float depth = aTrait.x;
  float phase = aSeed.z * TAU;
  // Near motes ride the air faster than the far haze, which is what separates
  // the strata as depth rather than as brightness.
  float t = uTime * uSpeed * mix(0.55, 1.15, depth) * aSeed.w;

  // Two incommensurate sine pairs per axis: a bounded wander that never repeats
  // on any timescale a visitor will sit through, for the cost of four sines.
  vec2 p = aSeed.xy;
  p.x += 0.052 * sin(t * 0.29 + phase) + 0.019 * sin(t * 0.71 + phase * 1.7);
  p.y += 0.044 * cos(t * 0.25 + phase * 1.3) + 0.016 * cos(t * 0.63 + phase * 2.1);
  // A settle slow enough to be felt rather than seen.
  p.y -= t * uLift;
  // Depth decides how much the page's scroll drags a stratum along: near motes
  // travel most of a screen, the far haze barely stirs.
  p.y += uScroll * mix(0.06, 0.42, depth);

  p = fract(p);
  // fract() teleports a mote across the field, so fade the seam out. Without
  // this the wrap is the only thing anyone notices.
  vec2 edge = min(p, 1.0 - p);
  float seam = smoothstep(0.0, 0.04, min(edge.x, edge.y));

  vec2 px = p * uResolution;

  // The pointer disturbs the air rather than repelling the dust: the push is
  // rotated off the radial by ~38 degrees, so the field curls around the cursor
  // and settles back once the pointer stops moving and its energy decays.
  vec2 away = px - uPointer;
  // Not named "distance": that is a built-in, and shadowing it upsets some
  // drivers even where the language allows it.
  float gap = length(away);
  float reach = uPointerRadius * (1.0 + 0.3 * uPointerEnergy);
  float influence = 1.0 - smoothstep(0.0, reach, gap);
  influence = influence * influence * uPointerEnergy;
  vec2 direction = away / max(gap, 1.0);
  vec2 curl = vec2(
    direction.x * 0.78 - direction.y * 0.62,
    direction.x * 0.62 + direction.y * 0.78
  );
  px += curl * influence * uPointerPush * mix(0.45, 1.0, depth);

  gl_Position = vec4((px / uResolution) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = min(aTrait.y * uSizeScale * (1.0 + 0.22 * influence), uMaxPoint);

  // Motes thin out over the reading column so the field never competes with the
  // text it sits behind. This is the whole reason the effect can stay on while
  // someone reads.
  float fromCentre = abs(px.x - uResolution.x * 0.5);
  float column = mix(
    1.0,
    smoothstep(uColumn.x * 0.55, uColumn.x * 1.25, fromCentre),
    uColumn.y
  );

  // Slow, per-mote brightness drift. Long enough that the field breathes and no
  // single mote ever reads as twinkling.
  float shimmer = 0.82 + 0.18 * sin(uTime * 0.55 * uSpeed + aTrait.w * TAU);
  // Near motes are large and out of focus, so they have to be fainter than the
  // far specks to carry the same weight.
  float weight = mix(0.46, 0.22, depth);
  float alpha = weight * uIntensity * seam * shimmer * column * (1.0 + 0.6 * influence);

  vColor = vec4(mix(uToneFar, uToneNear, depth), clamp(alpha, 0.0, 1.0));
  vShape = vec2(aTrait.z, mix(1.45, 0.7, depth));
}
`;

export const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 vColor;
varying vec2 vShape;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float radius = length(q);

  // Dust: a soft radial falloff whose exponent comes from depth, so far specks
  // stay tight and near motes read as out of focus.
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
