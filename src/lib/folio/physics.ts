import { folioPoint, TAU, type FolioView } from './geometry';

export interface Contact {
  x: number;
  y: number;
  dx: number;
  dy: number;
  pressure: number;
  twist: number;
}

/** Connected elastic lines. Rest positions follow the slow ambient folds; touch motion comes from
 * local forces and stored velocity on top of that moving surface. */
export class FolioSheet {
  readonly rest: Float32Array;
  readonly offset: Float32Array;
  readonly velocity: Float32Array;
  private scratch: Float32Array;

  constructor(
    readonly lines: number,
    readonly points: number,
    public view: FolioView,
    seed: number,
  ) {
    this.rest = new Float32Array(lines * points * 2);
    this.offset = new Float32Array(this.rest.length);
    this.velocity = new Float32Array(this.rest.length);
    this.scratch = new Float32Array(this.rest.length);
    this.reshape(view, seed, false);
  }

  reshape(view: FolioView, seed: number, preserve = true, time = 0) {
    this.view = view;
    for (let line = 0; line < this.lines; line++) {
      for (let point = 0; point < this.points; point++) {
        const i = (line * this.points + point) * 2;
        const [x, y] = folioPoint(
          (point / this.points) * TAU,
          line / (this.lines - 1),
          time,
          seed,
          view,
          { x: 0, y: 0, strength: 0 },
        );
        if (preserve) {
          this.offset[i] += this.rest[i]! - x;
          this.offset[i + 1] += this.rest[i + 1]! - y;
        }
        this.rest[i] = x;
        this.rest[i + 1] = y;
      }
    }
  }

  pluck(contact: Contact) {
    for (let i = 0; i < this.rest.length; i += 2) {
      const dx = this.rest[i]! + this.offset[i]! - contact.x;
      const dy = this.rest[i + 1]! + this.offset[i + 1]! - contact.y;
      const distance = Math.hypot(dx, dy);
      const weight = Math.exp((-distance * distance) / 24000);
      const kick = weight * (130 + contact.pressure * 170);
      const length = Math.max(distance, 12);
      this.velocity[i] += (dx / length - (dy / length) * contact.twist) * kick;
      this.velocity[i + 1] +=
        (dy / length + (dx / length) * contact.twist) * kick;
    }
  }

  step(dt: number, contacts: Iterable<Contact>): boolean {
    // Fixed small substeps keep tension stable after slow frames.
    const touches = Array.from(contacts);
    const steps = Math.ceil(Math.min(dt, 0.05) * 120);
    if (!steps) return false;
    const h = Math.min(dt, 0.05) / steps;
    let energy = 0;
    for (let step = 0; step < steps; step++) {
      this.scratch.set(this.offset);
      energy = 0;
      for (let line = 0; line < this.lines; line++) {
        for (let point = 0; point < this.points; point++) {
          const i = (line * this.points + point) * 2;
          const before =
            (line * this.points + ((point + this.points - 1) % this.points)) *
            2;
          const after = (line * this.points + ((point + 1) % this.points)) * 2;
          let fx = 0;
          let fy = 0;
          for (const contact of touches) {
            const dx = this.rest[i]! - contact.x;
            const dy = this.rest[i + 1]! - contact.y;
            const weight = Math.exp(-(dx * dx + dy * dy) / 17000);
            const distance = Math.max(24, Math.hypot(dx, dy));
            const force = weight * (350 + contact.pressure * 1400);
            fx +=
              force * (dx / distance - (contact.twist * dy) / distance) +
              weight * contact.dx * 150;
            fy +=
              force * (dy / distance + (contact.twist * dx) / distance) +
              weight * contact.dy * 150;
          }
          for (let axis = 0; axis < 2; axis++) {
            const j = i + axis;
            const displacement = this.scratch[j]!;
            const along =
              this.scratch[before + axis]! +
              this.scratch[after + axis]! -
              2 * displacement;
            const across =
              (line > 0
                ? this.scratch[j - this.points * 2]! - displacement
                : 0) +
              (line < this.lines - 1
                ? this.scratch[j + this.points * 2]! - displacement
                : 0);
            const acceleration =
              -32 * displacement -
              6.5 * this.velocity[j]! +
              95 * along +
              65 * across +
              (axis ? fy : fx);
            this.velocity[j] = Math.max(
              -600,
              Math.min(600, this.velocity[j]! + acceleration * h),
            );
            this.offset[j] = Math.max(
              -140,
              Math.min(140, displacement + this.velocity[j]! * h),
            );
            energy = Math.max(
              energy,
              Math.abs(this.velocity[j]!),
              Math.abs(this.offset[j]!) * 5,
            );
          }
        }
      }
    }
    if (energy < 0.08) {
      this.offset.fill(0);
      this.velocity.fill(0);
      return false;
    }
    return true;
  }

  point(line: number, point: number): [number, number] {
    const i = (line * this.points + (point % this.points)) * 2;
    const x = this.rest[i]! + this.offset[i]!;
    const y = this.rest[i + 1]! + this.offset[i + 1]!;
    // A smooth safety envelope prevents dragged lines crossing the copy
    // without projecting them onto the hard corners of a rectangular box.
    const dx = x - this.view.centerX;
    const dy = y - this.view.centerY;
    const rx = (this.view.quietWidth / 2 + 8) * 1.16;
    const ry = (this.view.quietHeight / 2 + 8) * 1.16;
    const radius = (Math.abs(dx / rx) ** 6 + Math.abs(dy / ry) ** 6) ** (1 / 6);
    if (radius < 1) {
      if (radius < 0.001) return [this.rest[i]!, this.rest[i + 1]!];
      return [this.view.centerX + dx / radius, this.view.centerY + dy / radius];
    }
    return [x, y];
  }
}
