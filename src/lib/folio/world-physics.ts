import type { FolioView } from './geometry';

export type WorldKind = 'star' | 'moon' | 'satellite';
export interface WorldBody {
  kind: WorldKind;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  radius: number;
  mass: number;
  light: number;
  curiosity: number;
  attentive: boolean;
  echo: number;
  minX: number;
  maxX: number;
}
export interface WorldPointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface WorldLink {
  a: number;
  b: number;
  length: number;
}
export interface WorldPulse {
  x: number;
  y: number;
  age: number;
  reached: number;
}
export interface FolioWorld {
  bodies: WorldBody[];
  links: WorldLink[];
  pulses: WorldPulse[];
  height: number;
  reach: number;
  echoes: { index: number; delay: number; strength: number }[];
  moonCooldown: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** [x, y, radius, mass]: a sitting cat in profile, facing the island, in CSS px. */
const FELIS: [number, number, number, number][] = [
  [-14, -100, 5, 0.7], // far ear
  [6, -80, 3.5, 0.5], // crown
  [26, -104, 6, 0.8], // near ear
  [44, -62, 4, 0.6], // muzzle
  [22, -24, 7, 1], // chest
  [40, 64, 5, 0.8], // forepaw
  [-40, 62, 6, 0.9], // haunch
  [-36, -28, 5, 0.8], // back
  [-78, 20, 4, 0.6], // tail tip
];
const FELIS_LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 0],
  [6, 8],
];

/** Two authored pockets live outside the whole navigation orbit, not just the cat. */
export function createWorld(view: FolioView): FolioWorld {
  const { width, height, centerX, quietWidth } = view;
  const left = centerX - quietWidth / 2 - 285;
  const right = centerX + quietWidth / 2 + 285;
  const world: FolioWorld = {
    bodies: [],
    links: [],
    pulses: [],
    echoes: [],
    moonCooldown: 0,
    height,
    reach: clamp(width * 0.085, 105, 165),
  };
  if (height < 700 || left < 120 || width - right < 120) return world;
  function add(
    kind: WorldKind,
    side: number,
    u: number,
    v: number,
    radius: number,
    mass = 1,
  ) {
    const minX = side ? right + 24 : 32;
    const maxX = side ? width - 32 : left - 24;
    const x = minX + (maxX - minX) * u;
    const y = 55 + (height - 175) * v;
    world.bodies.push({
      kind,
      x,
      y,
      homeX: x,
      homeY: y,
      vx: 0,
      vy: 0,
      angle: 0,
      spin: 0,
      radius,
      mass,
      light: 0,
      curiosity: 0,
      attentive: false,
      echo: 0,
      minX,
      maxX,
    });
    return world.bodies.length - 1;
  }
  function connect(a: number, b: number) {
    const first = world.bodies[a]!;
    const second = world.bodies[b]!;
    world.links.push({
      a,
      b,
      length: Math.hypot(first.x - second.x, first.y - second.y),
    });
  }
  // Felis, the cat Lalande set among the stars in 1799 and the IAU left off its
  // 1922 list: a sitting cat facing the island, traced ears to tail.
  // Scale uniformly, never stretch, so the figure stays a cat in any margin.
  const span = left - 24 - 32;
  const scale = Math.min(1.15, span / 150);
  const felis = FELIS.map(([x, y, radius, mass]) =>
    add(
      'star',
      0,
      0.56 + (x * scale) / span,
      0.34 + (y * scale) / (height - 175),
      radius,
      mass,
    ),
  );
  for (const [from, to] of FELIS_LINKS) connect(felis[from]!, felis[to]!);
  const moon = add('moon', 1, 0.5, 0.6, 19, 3);
  const satellite = add('satellite', 1, 0.5, 0.6, 4, 0.5);
  world.bodies[satellite]!.y -= 43;
  world.bodies[satellite]!.homeY -= 43;
  connect(moon, satellite);
  return world;
}

/** Travel only over authored star connections, once per node per gesture. */
function echoConstellation(world: FolioWorld, source: number) {
  const visited = new Set([source]);
  const queue = [{ index: source, delay: 0, strength: 1 }];
  for (const next of queue) {
    for (const link of world.links) {
      const index =
        link.a === next.index ? link.b : link.b === next.index ? link.a : -1;
      if (
        index < 0 ||
        visited.has(index) ||
        world.bodies[index]!.kind !== 'star'
      )
        continue;
      visited.add(index);
      const echo = {
        index,
        delay: next.delay + 0.2,
        strength: next.strength * 0.65,
      };
      queue.push(echo);
      world.echoes.push(echo);
    }
  }
  // Rapid pointer crossings must not build an unbounded reaction queue.
  world.echoes = world.echoes.slice(-12);
}

function releaseSatellite(world: FolioWorld, moon: WorldBody) {
  if (world.moonCooldown > 0) return;
  const satellite = world.bodies.find((body) => body.kind === 'satellite');
  if (!satellite) return;
  const dx = satellite.x - moon.x;
  const dy = satellite.y - moon.y;
  const length = Math.hypot(dx, dy) || 1;
  satellite.vx += (-dy / length) * 150;
  satellite.vy += (dx / length) * 150;
  satellite.echo = 0.75;
  world.moonCooldown = 18;
}

export function disturbWorld(world: FolioWorld, index: number) {
  const body = world.bodies[index];
  if (!body) return;
  world.pulses.push({ x: body.x, y: body.y, age: 0, reached: 0 });
  if (world.pulses.length > 3) world.pulses.shift();
  body.spin += 2;
  body.curiosity = 2;
  if (body.kind === 'star') echoConstellation(world, index);
  if (body.kind === 'moon') releaseSatellite(world, body);
}

/** Semi-implicit Euler, called at a fixed 120Hz; all forces are in CSS pixels/seconds. */
export function stepWorld(
  world: FolioWorld,
  pointer: WorldPointer | null,
  held: number,
  dt: number,
): boolean {
  let active = false;
  const { bodies, links } = world;
  world.moonCooldown = Math.max(0, world.moonCooldown - dt);
  for (const echo of world.echoes) {
    echo.delay -= dt;
    if (echo.delay <= 0) {
      const body = bodies[echo.index]!;
      body.echo = Math.max(body.echo, echo.strength);
      body.vy -= echo.strength * 9;
      body.spin += echo.strength * 0.35;
    }
  }
  world.echoes = world.echoes.filter((echo) => echo.delay > 0);
  for (const link of links) {
    const a = bodies[link.a]!;
    const b = bodies[link.b]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy) || 1;
    const relative = ((b.vx - a.vx) * dx + (b.vy - a.vy) * dy) / distance;
    const force = (distance - link.length) * 24 + relative * 2;
    a.vx += (((dx / distance) * force) / a.mass) * dt;
    a.vy += (((dy / distance) * force) / a.mass) * dt;
    b.vx -= (((dx / distance) * force) / b.mass) * dt;
    b.vy -= (((dy / distance) * force) / b.mass) * dt;
  }
  for (const pulse of world.pulses) {
    pulse.age += dt;
    bodies.forEach((body, index) => {
      const dx = body.x - pulse.x;
      const dy = body.y - pulse.y;
      const d = Math.hypot(dx, dy);
      if (!(pulse.reached & (1 << index)) && d < pulse.age * 180 && d < 230) {
        pulse.reached |= 1 << index;
        const kick = (55 * (1 - d / 230)) / body.mass;
        body.vx += (dx / (d || 1)) * kick;
        body.vy += (dy / (d || 1)) * kick;
        body.light = 1;
      }
    });
  }
  world.pulses = world.pulses.filter((pulse) => pulse.age < 1.4);
  bodies.forEach((body, index) => {
    const dx = pointer ? body.x - pointer.x : 0;
    const dy = pointer ? body.y - pointer.y : 0;
    const distance = Math.hypot(dx, dy);
    const proximity = pointer
      ? Math.max(0, 1 - distance / world.reach) ** 2
      : 0;
    const speed = pointer ? Math.hypot(pointer.vx, pointer.vy) : 0;
    const attentive = proximity > 0.32;
    if (body.kind === 'star' && attentive && !body.attentive)
      echoConstellation(world, index);
    body.attentive = attentive;
    const moonAttention =
      body.kind === 'moon' && proximity > 0.2 && speed < 32 && held < 0;
    body.curiosity = clamp(
      body.curiosity + (moonAttention ? dt : -dt * 0.7),
      0,
      2,
    );
    if (moonAttention && body.curiosity >= 1.6 && world.moonCooldown === 0)
      releaseSatellite(world, body);
    body.echo *= Math.exp(-dt * 2.4);
    if (body.echo < 0.002) body.echo = 0;
    const direction = body.kind === 'moon' ? -0.5 : 1;
    const wind = 0.32;
    const force = (proximity * 430 * direction) / body.mass;
    body.vx +=
      ((dx / (distance || 1)) * force +
        ((pointer?.vx ?? 0) * proximity * wind) / body.mass) *
      dt;
    body.vy +=
      ((dy / (distance || 1)) * force +
        ((pointer?.vy ?? 0) * proximity * wind) / body.mass) *
      dt;
    body.spin +=
      (((pointer?.vx ?? 0) * dy - (pointer?.vy ?? 0) * dx) *
        proximity *
        dt *
        0.0008) /
      body.mass;
    const dragging = held === index && pointer;
    const stiffness = dragging ? 110 : body.kind === 'satellite' ? 0.9 : 5;
    const targetX = dragging
      ? clamp(pointer.x, body.minX + body.radius, body.maxX - body.radius)
      : body.homeX;
    const targetY = dragging
      ? clamp(pointer.y, 48 + body.radius, world.height - 100 - body.radius)
      : body.homeY;
    body.vx += (((targetX - body.x) * stiffness) / body.mass) * dt;
    body.vy += (((targetY - body.y) * stiffness) / body.mass) * dt;
    const damping = Math.exp(
      -(dragging ? 12 : body.kind === 'satellite' ? 0.7 : 2.8) * dt,
    );
    body.vx = clamp(body.vx * damping, -650, 650);
    body.vy = clamp(body.vy * damping, -650, 650);
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    const velocity = Math.hypot(body.vx, body.vy);
    // Ease back upright by the shortest angular arc.
    const turn = Math.atan2(Math.sin(-body.angle), Math.cos(-body.angle));
    body.spin = (body.spin + turn * 3 * dt) * Math.exp(-2 * dt);
    body.angle += body.spin * dt;
    const light = Math.min(1, proximity + velocity / 240 + body.echo);
    body.light += (light - body.light) * (1 - Math.exp(-dt * 5));
    active ||=
      velocity > 0.05 ||
      body.echo > 0 ||
      Math.abs(body.spin) > 0.002 ||
      Math.abs(body.light - light) > 0.002 ||
      (body.curiosity > 0 && body.curiosity < 2);
  });
  // ponytail: pair scan is bounded to ten bodies; use a spatial index if density grows.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const overlap = a.radius + b.radius + 4 - d;
      if (overlap <= 0) continue;
      const nx = dx / d || 1;
      const ny = dy / d;
      const total = a.mass + b.mass;
      a.x -= (nx * overlap * b.mass) / total;
      a.y -= (ny * overlap * b.mass) / total;
      b.x += (nx * overlap * a.mass) / total;
      b.y += (ny * overlap * a.mass) / total;
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing < 0) {
        const impulse = (-1.55 * closing) / (1 / a.mass + 1 / b.mass);
        a.vx -= (nx * impulse) / a.mass;
        a.vy -= (ny * impulse) / a.mass;
        b.vx += (nx * impulse) / b.mass;
        b.vy += (ny * impulse) / b.mass;
        a.spin -= impulse * 0.008;
        b.spin += impulse * 0.008;
      }
      active = true;
    }
  }
  // Hard guard after collisions and dragging: no body can enter the protected composition.
  for (const body of bodies) {
    const x = clamp(body.x, body.minX + body.radius, body.maxX - body.radius);
    const y = clamp(body.y, 48 + body.radius, world.height - 100 - body.radius);
    if (x !== body.x) body.vx *= -0.35;
    if (y !== body.y) body.vy *= -0.35;
    body.x = x;
    body.y = y;
  }
  return active || world.pulses.length > 0 || world.echoes.length > 0;
}
