// Visual-only snapshots, in board-cell units so resizing cannot misalign them.
import { HIDDEN } from './engine.js';

export const MAX_PARTICLES = 280;
export const FRAGMENTS_PER_CELL = 4;
export const DUST_PER_CELL = 1;
export const PARTICLES_PER_CELL = FRAGMENTS_PER_CELL + DUST_PER_CELL;
export const EFFECT_MS = 800;
const DUST_MS = 240;
const GLYPH_MS = 300;
const FLASH_MS = 80;
const PARTICLE_DELAY_MS = 80;
const MAX_CELLS = 80; // Also bound the fading snapshots during rapid clears.

export class LineClearEffect {
  constructor() {
    this.clear();
  }

  clear() {
    this.particles = [];
    this.cells = [];
  }

  emit(rows, { paused = false, gameOver = false } = {}) {
    if (paused || gameOver) return;
    const strength = [1, 1, 1.08, 1.15, 1.25][Math.min(rows.length, 4)];
    for (const { y, cells } of rows) {
      // Engine rows include two hidden spawn rows; only paint visible cells.
      if (y < HIDDEN) continue;
      cells.forEach((cell, x) => {
        if (!cell) return;
        this.cells.push({ x, y: y - HIDDEN, type: cell.type, character: cell.character, age: 0, strength });
        for (let i = 0; i < PARTICLES_PER_CELL; i++) {
          const fragment = i < FRAGMENTS_PER_CELL;
          const side = i % 2 ? 1 : -1;
          this.particles.push({
            x: x + (fragment ? (i % 2 ? 0.72 : 0.28) : 0.5),
            y: y - HIDDEN + (fragment ? (i < 2 ? 0.28 : 0.72) : 0.5),
            type: cell.type, age: 0, kind: fragment ? 'fragment' : 'dust',
            delay: fragment ? PARTICLE_DELAY_MS : 20,
            lifetime: fragment ? EFFECT_MS : DUST_MS,
            vx: side * (0.5 + Math.random() * 1.5) * strength,
            vy: fragment ? -1 + Math.random() * 3 : -1 + Math.random() * 2,
            gravity: fragment ? 18 + Math.random() * 8 : 5,
            width: fragment ? (0.32 + Math.random() * 0.16) * (1 + (strength - 1) * 0.4) : 0.06,
            height: fragment ? (0.22 + Math.random() * 0.16) * (1 + (strength - 1) * 0.4) : 0.06,
            angle: (Math.random() - 0.5) * 0.3,
            spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4),
          });
        }
      });
    }
    // Append order is birth order: discard the oldest first.
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    if (this.cells.length > MAX_CELLS) this.cells.splice(0, this.cells.length - MAX_CELLS);
  }

  update(dt) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const item of this.particles) {
      const before = Math.max(0, item.age - item.delay);
      item.age += elapsed;
      const active = (Math.max(0, Math.min(item.age, item.lifetime) - item.delay) - before) / 1000;
      item.x += item.vx * active;
      item.y += item.vy * active + 0.5 * item.gravity * active * active;
      item.vy += item.gravity * active;
      item.angle += item.spin * active;
    }
    for (const item of this.cells) item.age += elapsed;
    this.particles = this.particles.filter(item => item.age < item.lifetime);
    this.cells = this.cells.filter(item => item.age < GLYPH_MS);
  }

  draw(ctx, size, colorForType, width, height, clipTop = 0) {
    if (!this.cells.length && !this.particles.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, width, height - clipTop);
    ctx.clip();
    for (const cell of clipTop ? [] : this.cells) {
      const x = cell.x * size, y = cell.y * size;
      if (cell.age < FLASH_MS) {
        const fade = 1 - cell.age / FLASH_MS;
        ctx.globalAlpha = fade * 0.65;
        ctx.fillStyle = colorForType(cell.type);
        ctx.fillRect(x, y, size, size);
        ctx.globalAlpha = fade * 0.65 * cell.strength;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = cell.age < 80 ? 1 - 0.15 * cell.age / 80
        : cell.age < 220 ? 0.85 - 0.7 * (cell.age - 80) / 140
        : 0.15 * (GLYPH_MS - cell.age) / 80;
      ctx.font = `600 ${size * 0.62 * (1 + 0.1 * Math.min(1, cell.age / 60))}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, size * 0.07);
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      const jitter = cell.age < 80 ? Math.sin(cell.age / 80 * Math.PI * 2) * size * 0.035 : 0;
      ctx.strokeText(cell.character, x + size / 2 + jitter, y + size / 2);
      ctx.fillText(cell.character, x + size / 2 + jitter, y + size / 2);
    }
    for (const particle of this.particles) {
      if (particle.age < particle.delay) continue;
      const fragment = particle.kind === 'fragment';
      const fade = fragment ? Math.max(0, (particle.age - 500) / 300)
        : (particle.age - particle.delay) / (particle.lifetime - particle.delay);
      const scale = fragment ? 1 - 0.85 * fade : 1 - fade;
      ctx.globalAlpha = (fragment ? 0.9 : 0.3) * (1 - fade);
      ctx.fillStyle = colorForType(particle.type);
      ctx.save();
      ctx.translate(particle.x * size, particle.y * size);
      ctx.rotate(particle.angle);
      const w = particle.width * size * scale, h = particle.height * size * scale;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
  }
}
