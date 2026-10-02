// Feedback only: never part of the falling-idiom pool or scoring rules.
export const LINE_CLEAR_REWARDS = Object.freeze({
  1: '万里挑一',
  2: '全军出击',
  3: '飞龙在天',
  4: '势如破竹',
});
export const REWARD_MS = 1600;
export const REWARD_FREEZE_MS = 600;

export class RewardOverlay {
  constructor() { this.clear(); }

  clear() { this.current = null; }

  get freezing() { return this.current !== null && this.current.age < REWARD_FREEZE_MS; }

  show(clearCount, { paused = false, gameOver = false } = {}) {
    if (paused || gameOver || !Number.isInteger(clearCount) || clearCount < 1 || clearCount > 4) return false;
    // One slot: replace the previous phrase and restart its clock.
    this.current = { phrase: LINE_CLEAR_REWARDS[clearCount], age: 0 };
    return true;
  }

  update(dt) {
    if (!this.current) return;
    this.current.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.current.age >= REWARD_MS) this.clear();
  }

  draw(ctx, width, height) {
    if (!this.current) return;
    const age = this.current.age;
    const opacity = Math.min(1, age / 160, (REWARD_MS - age) / 500);
    const scale = age < 100 ? 0.75 + 0.37 * age / 100
      : age < 180 ? 1.12 : age < 280 ? 1.12 - 0.12 * (age - 180) / 100 : 1;
    const fontSize = width * 0.125;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.translate(width / 2, height * 0.18);
    ctx.scale(scale, scale);
    ctx.globalAlpha = opacity;
    // A restrained backing keeps glyphs legible on every existing theme.
    ctx.fillStyle = 'rgba(12,18,28,0.78)';
    ctx.fillRect(-fontSize * 3.2, -fontSize * 0.8, fontSize * 6.4, fontSize * 1.6);
    ctx.font = `900 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = 3;
    ctx.strokeStyle = '#132036';
    ctx.lineWidth = Math.max(2, fontSize * 0.09);
    ctx.lineJoin = 'round';
    ctx.strokeText([...this.current.phrase].join(' '), 0, 0);
    ctx.fillText([...this.current.phrase].join(' '), 0, 0);
    ctx.restore();
  }
}
