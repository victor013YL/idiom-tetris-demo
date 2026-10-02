// tetris — app.js
// ============================================================================
// THE GLUE.
//
// This is where everything is wired together. It owns:
//   - the boot sequence (apply settings, create modules, show title screen)
//   - the requestAnimationFrame loop (calls engine.tick + renderer.draw)
//   - the overlay state machine (title / playing / paused / game-over)
//   - the settings dialog (theme/mode/zoom/sfx/server URL)
//   - the game-over receipt flow (submit to server OR download local file)
//   - service-worker registration
//
// app.js is intentionally the "messy" file: it knows about every other
// module. That's fine — the other modules know about nothing.
// ============================================================================

import { Engine, ROWS, COLS } from './engine.js';
import { IdiomManager } from './idiom-manager.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Background } from './background.js';
import { Sound } from './sound.js';
import { settings } from './storage.js';
import { Scoreboard } from './scoreboard.js';

// Bump this string on every release; it ends up inside every signed receipt
// so users can prove which client version played the game. Pair it with the
// version string in index.html for consistency.
const CLIENT_VERSION = '1.5.6';

// Convenience: jQuery's $ but it's just querySelector.
const $ = (q) => document.querySelector(q);

// ---------------------------------------------------------------------------
// Apply settings → DOM
// ---------------------------------------------------------------------------
// Persisted preferences live in localStorage (via storage.js). They control:
//   - <html data-theme=…> and <html data-mode=…> (CSS themes pick this up)
// SIZING MODEL (v1.3.0 — pixel-perfect rewrite)
// --------------------------------------------
// One source of truth: --board-h on .game-wrap, in CSS pixels.
// Everything else — canvas, HUD widths, gap — is derived in game.css.
//
//   actual_board_h = snapToGrid(fittedBaseHeight * zoomMultiplier)
//
// THE KEY INSIGHT (why prior versions had drift on zoom):
// The play grid is 10 cols × ROWS rows. The renderer draws each cell at
//   cell = canvas.width / 10.
// For the playfield to align EXACTLY with the board frame top-and-bottom,
// --board-h MUST be a multiple of ROWS (= 20) so cell is an integer number
// of CSS pixels. Otherwise the 20×cell stack either stops short of the
// bottom (empty zone under the last row) or overflows past it (bottom row
// clipped by the frame). Snapping --board-h to a 20-row grid eliminates
// both failure modes for every zoom level on every device.
//
// We also measure the actual rendered chrome (page header, HUDs, vpad) via
// real DOM rects instead of guessing with a hardcoded mobile reservation.
// v1.4.1 — cell size (px) is the integer source of truth. JS picks the
// largest integer cell that fits BOTH budgets, then derives --board-h and
// --board-w from it. CSS no longer derives one dim from the other.
const BOARD_ASPECT = 2;          // height / width (ROWS=20 / COLS=10)
const CELL_MIN = 14;             // never go below 14 px cells
const CELL_MAX = 46;             // never balloon past 46 px cells
const BOARD_MIN_H = ROWS * CELL_MIN; // 280
const BOARD_MAX_H = ROWS * CELL_MAX; // 920

// Snap a board height down to the nearest multiple of ROWS so each cell
// is an integer number of CSS pixels. Returns an integer >= ROWS.
function snapToGrid(h) {
  const cell = Math.max(1, Math.floor(h / ROWS));
  return cell * ROWS;
}

// outerH — element's box height including margins. Returns 0 if hidden.
function outerH(el) {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (!r.height) return 0;
  const cs = getComputedStyle(el);
  return r.height + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);
}

// Vertical budget available for the board itself, inside .stage.
//
// v1.5.0 mobile model is FUNDAMENTALLY different from desktop:
//   - .stage is 100dvh × 100vw with zero padding.
//   - .board-frame is edge-to-edge with zero padding/border.
//   - .mobile-bar floats over the top (position:fixed) — it is NOT a child
//     of .stage, so the old sibling-subtraction loop misses it. We must
//     measure its bottom edge explicitly from the viewport top and subtract.
//   - .vpad floats over the bottom (position:fixed) at very low opacity —
//     it does NOT eat board space; the board renders behind it.
function availableBoardHeight() {
  const stage = document.querySelector('.stage');
  const wrap = document.getElementById('game-wrap');
  if (!stage || !wrap) return BOARD_MIN_H;

  const isMobile = matchMedia('(max-width: 760px)').matches;

  // ---- MOBILE: board = full viewport minus floating mobile-bar minus safe-area-bottom.
  if (isMobile) {
    const mb = document.getElementById('mobile-bar');
    // Mobile-bar is fixed:top — its .bottom is the px below the viewport top
    // where the bar ends. Add a small breathing gap so the playfield doesn't
    // butt against the bar's blurred edge.
    const mbBottom = mb ? mb.getBoundingClientRect().bottom : 56;
    // Read safe-area-inset-bottom from a probe element — CSS env() isn't
    // accessible from JS directly, so we read the computed style of body's
    // padding-bottom (which is set to env(safe-area-inset-bottom) by base.css
    // on supporting browsers). Fallback to 0.
    const vpad = document.getElementById('vpad');
    const controlsHeight = vpad && document.body.classList.contains('vpad-on') ? Math.max(104, outerH(vpad)) : 0;
    const safeBottom = 16;
    return Math.max(BOARD_MIN_H, window.innerHeight - Math.max(148, mbBottom) - controlsHeight - safeBottom - 8);
  }

  // ---- DESKTOP: pre-v1.5.0 logic, untouched.
  const stageRect = stage.getBoundingClientRect();
  const cs = getComputedStyle(stage);
  const padY = parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);

  // Subtract every sibling of .game-wrap inside .stage (e.g. vpad on desktop
  // if it ever showed there — it doesn't, but keep the loop for safety).
  let chromeY = padY;
  for (const child of stage.children) {
    if (child === wrap) continue;
    chromeY += outerH(child);
  }

  // Board-frame's own padding + border eats into the canvas height —
  // subtract it so the canvas fits the budget exactly.
  const frame = wrap.querySelector(':scope > .board-frame');
  if (frame) {
    const fcs = getComputedStyle(frame);
    chromeY += parseFloat(fcs.paddingTop || 0) + parseFloat(fcs.paddingBottom || 0)
             + parseFloat(fcs.borderTopWidth || 0) + parseFloat(fcs.borderBottomWidth || 0);
  }

  return Math.max(BOARD_MIN_H, stageRect.height - chromeY);
}

// Horizontal budget for the board. On desktop the two HUD columns + two
// grid gaps share the row, so subtract them. On mobile the board uses the
// full stage width (clamped to a small viewport-edge inset).
function availableBoardWidth() {
  const stage = document.querySelector('.stage');
  const wrap = document.getElementById('game-wrap');
  if (!stage || !wrap) return BOARD_MIN_H / BOARD_ASPECT;

  const stageRect = stage.getBoundingClientRect();
  const isMobile = matchMedia('(max-width: 760px)').matches;

  // Board-frame's own horizontal padding + border eats into the canvas width.
  // Pre-v1.4.3 we only subtracted this from the HEIGHT budget, so the canvas
  // (at --board-w) overflowed the frame's right edge by 18px (8+1 each side).
  // Subtract it here too — matches availableBoardHeight()'s pattern.
  let framePadX = 0;
  const frame = wrap.querySelector(':scope > .board-frame');
  if (frame) {
    const fcs = getComputedStyle(frame);
    framePadX = parseFloat(fcs.paddingLeft || 0) + parseFloat(fcs.paddingRight || 0)
              + parseFloat(fcs.borderLeftWidth || 0) + parseFloat(fcs.borderRightWidth || 0);
  }

  if (isMobile) {
    // v1.5.0: board frame is edge-to-edge (no padding/border), so the budget
    // is the FULL viewport width. The canvas is centered inside via flex.
    return Math.max(BOARD_MIN_H / BOARD_ASPECT, window.innerWidth - framePadX - 16);
  }
  const cs = getComputedStyle(wrap);
  const hudW = parseFloat(cs.getPropertyValue('--hud-w')) || 130;
  const gap = parseFloat(cs.getPropertyValue('--gap')) || 18;
  return Math.max(BOARD_MIN_H / BOARD_ASPECT, stageRect.width - 2 * hudW - 2 * gap - framePadX);
}

// Pick the largest board height that satisfies both budgets, then snap to grid.
function computeFittedHeight() {
  const fromH = availableBoardHeight();
  const fromW = availableBoardWidth() * BOARD_ASPECT;
  const raw = Math.min(fromH, fromW, BOARD_MAX_H);
  return Math.max(BOARD_MIN_H, snapToGrid(raw));
}

function applyBoardSize() {
  const wrap = document.getElementById('game-wrap');
  if (!wrap) return;
  const s = settings.state;

  // 1) Budgets in CSS pixels (post-chrome, post-padding, post-border).
  const availH = availableBoardHeight();
  const availW = availableBoardWidth();

  // 2) Largest INTEGER cell that fits both budgets, then apply zoom & clamps.
  //    cellFromH = availH / ROWS; cellFromW = availW / COLS. Use min, floor.
  const cellFit = Math.max(1, Math.floor(Math.min(availH / ROWS, availW / COLS)));
  const z = (s.zoom || 100) / 100;
  const ceilingCell = Math.min(cellFit, CELL_MAX);
  const zoomedCell = Math.floor(cellFit * z);
  let cell = Math.min(zoomedCell, ceilingCell);
  cell = Math.max(CELL_MIN, cell);

  // 3) Derive --board-h and --board-w from the SAME integer cell. The grid
  //    column and canvas are now guaranteed to agree, so renderer.resize()
  //    (cell = rect.width / COLS) draws exactly 20 rows that fill the canvas
  //    height edge-to-edge. No empty band, no clipped bottom row, at any zoom.
  const boardH = cell * ROWS;
  const boardW = cell * COLS;
  wrap.style.setProperty('--board-h', boardH + 'px');
  wrap.style.setProperty('--board-w', boardW + 'px');

  // Renderer's bitmap must follow the new CSS size. Double-rAF waits for
  // style applied + layout flushed. Without the v1.4.0 CSS transition
  // mid-tween mismatch (now removed), one rAF would suffice — two is
  // bulletproof on devices with deferred layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof renderer !== 'undefined') renderer.resize();
    });
  });
}

//   - --zoom CSS variable on #game-wrap (zoom in/out, multiplier)
//   - --board-h CSS variable on #game-wrap (fitted base height in px)
//   - body.vpad-on class (show on-screen D-pad)
function applySettings() {
  const s = settings.state;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.mode = s.mode;

  // Virtual pad visibility: 'always', 'never', or 'auto' = show on coarse pointer
  // (i.e., touch devices). matchMedia('(pointer: coarse)') is the canonical check.
  const wantsVPad = s.vpadMode === 'always'
    || (s.vpadMode === 'auto' && matchMedia('(pointer: coarse)').matches);
  document.body.classList.toggle('vpad-on', wantsVPad);

  applyBoardSize();
}

// "Fit to screen" simply resets the manual zoom to 100% and re-applies; the
// base size (computeFittedHeight) already adapts to the viewport.
function fitToScreen() {
  settings.patch({ fit: true, zoom: 100 });
  applyBoardSize();
}

// Keep the board in sync when the viewport changes (resize, orientation flip,
// browser UI bars showing/hiding, keyboard appearing).
// Finish async data loading before registering layout work that needs Renderer.
const idioms = await IdiomManager.load();

let _resizeRaf = 0;
function scheduleApplyBoardSize() {
  if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
  _resizeRaf = requestAnimationFrame(() => { _resizeRaf = 0; applyBoardSize(); });
}
window.addEventListener('resize', scheduleApplyBoardSize);
window.addEventListener('orientationchange', scheduleApplyBoardSize);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applySettings();

// One Engine, one Sound, one Renderer, one Background, one Scoreboard. These
// live for the entire page lifetime — switching themes / modes / restarting
// the game does NOT re-create them.
const engine = new Engine({
  nextIdiom: () => idioms.random(),
  onLineClear: rows => {
    renderer.effects.emit(rows, { paused: engine.paused, gameOver: engine.gameOver });
    renderer.reward.show(rows.length, { paused: engine.paused, gameOver: engine.gameOver });
    input.cancelPending();
  },
});
const sound = new Sound();
const renderer = new Renderer({
  canvas: $('#game-canvas'),
  holdCanvas: $('#hold-canvas'),
  nextCanvas: $('#next-canvas'),
  // v1.5.0 — mobile floating bar mirrors HOLD + NEXT into its own mini-canvases.
  // The renderer draws into them in parallel with the desktop HUD canvases.
  holdCanvasMobile: $('#hold-canvas-mobile'),
  nextCanvasMobile: $('#next-canvas-mobile'),
});
const bg = new Background($('#bg-canvas'));
const scoreboard = new Scoreboard();

// Game-session stats — fed into the PGP-signed receipt at game over.
// `pieces` starts at 1 because the first piece is spawned by the engine
// before the player makes any move (so it never gets counted via trackPiece).
const stats = { pieces: 0, holds: 0, hardDrops: 0, softDrops: 0, rotates: 0, maxCombo: 0, tetrises: 0 };
let started = false;
let lastTickActedOnPiece = engine.current;

// Called every frame from the game loop. Detects when the current piece
// reference changes (a new piece spawned) and increments the piece counter.
// Also tracks max combo and total Tetrises for the receipt.
const trackPiece = () => {
  if (engine.current !== lastTickActedOnPiece) {
    lastTickActedOnPiece = engine.current;
    stats.pieces++;
  }
  if (engine.combo > stats.maxCombo) stats.maxCombo = engine.combo;
  if (engine.lastClear?.n === 4) stats.tetrises++;
};

// ---------------------------------------------------------------------------
// Overlay state machine
// ---------------------------------------------------------------------------
// One <div id="overlay"> hosts three screens: title, paused, game-over. We
// just swap innerHTML and re-bind buttons. Tiny, no framework, no router.
const overlayEl = $('#overlay');
const overlayCard = $('#overlay-card');

function showOverlay(html) {
  delete overlayEl.dataset.mode;
  overlayCard.innerHTML = html;
  overlayEl.hidden = false;
}
function hideOverlay() { overlayEl.hidden = true; }

function titleScreen() {
  // v1.5.0 — show the right hint for the device. Touch-primary devices get
  // the gesture cheat-sheet; everyone else gets the keyboard cheat-sheet.
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const isMobile = matchMedia('(max-width: 760px)').matches;
  const hint = isTouch
    ? '轻点旋转 · 左右拖动移动 · 下拖加速 · 上划硬降 · 长按暂存'
    : '↑ / X 顺时针 · Z 逆时针 · ← → 移动 · ↓ 加速 · 空格硬降 · C 暂存 · P 暂停';
  // v1.5.6 — mobile-only friendly heads-up. Touch tetris works, but the
  // experience is genuinely better with a real keyboard. We say so once,
  // on the title screen only, then never again.
  const mobileTip = isMobile
    ? '<small class="mobile-tip">提示：也可连接键盘操作</small>'
    : '';
  showOverlay(`
    <h1>俄罗斯成语方块儿</h1>
    <p>落下成语，消除方块。</p>
    <button class="cta" id="overlay-start">开始游戏</button>
    <small>${hint}</small>
    ${mobileTip}
  `);
  $('#overlay-start').addEventListener('click', startGame);
}
function pausedScreen() {
  showOverlay('<button id="overlay-resume" aria-label="已暂停，点击继续">已暂停 · P 继续</button>');
  overlayEl.dataset.mode = 'pause';
  $('#overlay-resume').addEventListener('click', () => action('pause'));
}
function gameOverScreen() {
  showOverlay(`
    <h1>游戏结束</h1>
    <p><strong>${engine.score.toLocaleString()}</strong> 分 · 消除 ${engine.lines} 行 · 等级 ${engine.level}</p>
    <button class="cta" id="overlay-submit">保存成绩</button>
    <button class="cta" id="overlay-again" style="background:transparent;color:var(--color-text);border:1px solid var(--color-border)">重新开始</button>
  `);
  $('#overlay-submit').addEventListener('click', openGameOver);
  $('#overlay-again').addEventListener('click', startGame);
}

function startGame() {
  input.cancelPending();
  input.uiFrozen = false;
  input.closeUI?.();
  sound.stopClear?.();
  sound.stopRotate?.();
  engine.reset();
  renderer.effects.clear();
  renderer.reward.clear();
  Object.assign(stats, { pieces: 1, holds: 0, hardDrops: 0, softDrops: 0, rotates: 0, maxCombo: 0, tetrises: 0 });
  lastTickActedOnPiece = engine.current;
  started = true;
  hideOverlay();
  // Audio contexts on iOS/Safari only unlock after a user gesture — this
  // click is that gesture, so we call sound.ensure() here, not on boot.
  // The same gesture also starts music if the user has it enabled.
  sound.ensure();
  if (settings.get('music')) sound.setMusic(true);
}

titleScreen();

// ---------------------------------------------------------------------------
// Action handler — the Input module emits these strings.
// ---------------------------------------------------------------------------
// If a game hasn't started (title or game-over), only 'drop' (Space) and
// 'rotate' (Up/X/tap) act as "press any key to start". Other actions are
// ignored. Once a game is running, we route into the engine and play SFX.
function action(a) {
  if (input.uiFrozen) return;
  if (!started || engine.gameOver) {
    if (a === 'drop' || a === 'rotate') startGame();
    return;
  }
  if (engine.paused && a !== 'pause') return;
  if (renderer.reward.freezing && a !== 'pause') return;
  switch (a) {
    case 'left':       if (engine.move(-1)) sound.move(); break;
    case 'right':      if (engine.move(1))  sound.move(); break;
    case 'soft':       if (engine.softDrop()) { sound.move(); stats.softDrops++; } break;
    case 'rotate':     if (engine.rotate(1)) { sound.rotate(); stats.rotates++; } break;
    case 'rotateCCW':  if (engine.rotate(-1)) { sound.rotate(); stats.rotates++; } break;
    case 'hold':       if (engine.holdPiece()) { sound.hold(); stats.holds++; } break;
    case 'drop': {
      const cells = engine.hardDrop();
      if (cells > 0) { sound.drop(); stats.hardDrops++; }
      break;
    }
    case 'pause': input.cancelPending(); engine.togglePause(); if (engine.paused) pausedScreen(); else hideOverlay(); break;
  }
}

// v1.5.6 — touch listener now binds to .board-frame (the full play
// container) instead of just the canvas. The canvas is sized to integer
// cells and pinned to the bottom of the frame, which leaves a strip of
// non-canvas area above (between mobile-bar and the canvas top) where
// touches were not registering. Binding to the frame means *any* touch
// inside the playfield container reveals the vpad and is parsed as a
// gesture. Gesture math is still relative to clientX/Y (viewport-based),
// so we don't care that the target is now the frame instead of the canvas.
const input = new Input({
  boardEl: document.querySelector('.board-frame'),
  vpadEl: $('#vpad'),
  onAction: action,
  isBlocked: () => input.uiFrozen || engine.paused || renderer.reward.freezing,
});

// ---------------------------------------------------------------------------
// Dialog open-state tracker (v1.5.6).
// ---------------------------------------------------------------------------
// Native <dialog>.showModal() puts the dialog in the browser's top layer,
// which is supposed to render above every position:fixed element. iOS
// Safari and Chrome iOS sometimes paint the vpad and floating mobile-bar
// on top of the backdrop anyway — a long-known WebKit quirk around
// `position: fixed` + top-layer interaction. We solve it the safe way:
// observe any <dialog> opening, and toggle `body.dialog-open` so the CSS
// can hide the conflicting floating chrome while a modal is up.
const _dialogObserver = new MutationObserver(() => {
  const anyOpen = !!document.querySelector('dialog[open]');
  document.body.classList.toggle('dialog-open', anyOpen);
});
document.querySelectorAll('dialog').forEach(d => {
  _dialogObserver.observe(d, { attributes: true, attributeFilter: ['open'] });
});

// ---------------------------------------------------------------------------
// Settings dialog — <dialog> element + a normal <form>, no React.
// ---------------------------------------------------------------------------
const settingsDialog = $('#settings-dialog');
input.closeUI = () => { if (settingsDialog.open) settingsDialog.close(); };
$('#btn-settings').addEventListener('click', () => {
  // Sync form values to current settings (so the dialog reflects the truth).
  const f = settingsDialog.querySelector('form');
  f.querySelectorAll('input[name=theme]').forEach(i => i.checked = i.value === settings.get('theme'));
  f.querySelectorAll('input[name=mode]').forEach(i => i.checked = i.value === settings.get('mode'));
  f.querySelector('input[name=zoom]').value = settings.get('zoom');
  f.querySelector('output[name=zoom-out]').value = settings.get('zoom') + '%';
  f.querySelector('input[name=fit]').checked = !!settings.get('fit');
  f.querySelector('select[name=vpad-mode]').value = settings.get('vpadMode');
  f.querySelector('input[name=sfx]').checked = !!settings.get('sfx');
  f.querySelector('input[name=music]').checked = !!settings.get('music');
  for (const key of ['musicVolume', 'sfxVolume']) {
    f.querySelector(`input[name=${key}]`).value = Math.round(settings.get(key) * 100);
    f.querySelector(`output[name=${key}-out]`).value = Math.round(settings.get(key) * 100) + '%';
  }
  f.querySelector('input[name=server]').value = settings.get('server') || '';
  settingsDialog.returnValue = '';
  input.cancelPending();
  input.uiFrozen = true;
  settingsDialog.showModal();
});
// Live-update the zoom output label as the range slider moves.
settingsDialog.querySelector('input[name=zoom]').addEventListener('input', (e) => {
  settingsDialog.querySelector('output[name=zoom-out]').value = e.target.value + '%';
});
// Live-toggle music the moment the checkbox changes (without waiting for
// Save). Clicking the checkbox is a valid user gesture, which is what the
// AudioContext needs to unlock on iOS/Safari — so the music can actually
// start playing here even if the player hasn't yet hit Press Start.
settingsDialog.querySelector('input[name=music]').addEventListener('change', (e) => {
  sound.ensure();
  settings.set('music', e.target.checked);
  sound.setMusic(e.target.checked);
});
// Same for SFX — toggle live so the player hears the effect on rotate/move.
settingsDialog.querySelector('input[name=sfx]').addEventListener('change', (e) => {
  settings.set('sfx', e.target.checked);
  sound.enabled = e.target.checked;
  if (!sound.enabled) sound.stopRotate?.();
  if (!sound.enabled) sound.stopClear?.();
});
for (const key of ['musicVolume', 'sfxVolume']) {
  settingsDialog.querySelector(`input[name=${key}]`).addEventListener('input', e => {
    const volume = Number(e.target.value) / 100;
    settings.set(key, volume);
    sound.setVolume(key, volume);
    settingsDialog.querySelector(`output[name=${key}-out]`).value = e.target.value + '%';
  });
}
// On close, if the user clicked "Save", harvest form values and persist.
// <dialog>'s returnValue is set by the <button value="save"> that closed it.
settingsDialog.addEventListener('close', () => {
  input.cancelPending();
  input.uiFrozen = false;
  if (settingsDialog.returnValue !== 'save') return;
  const f = settingsDialog.querySelector('form');
  const fd = new FormData(f);
  settings.patch({
    theme: fd.get('theme'),
    mode: fd.get('mode'),
    zoom: Number(fd.get('zoom')),
    fit: fd.get('fit') === 'on',
    vpadMode: fd.get('vpad-mode'),
    sfx: fd.get('sfx') === 'on',
    music: fd.get('music') === 'on',
    server: (fd.get('server') || '').toString().trim(),
  });
  sound.enabled = settings.get('sfx');
  sound.setMusic(settings.get('music'));
  scoreboard.setServer(settings.get('server'));
  applySettings();
});

// Quick-access buttons in the header bar (skip the dialog).
$('#btn-mode').addEventListener('click', () => {
  settings.set('mode', settings.get('mode') === 'dark' ? 'light' : 'dark');
  applySettings();
});
// v1.5.0 — mobile-bar mirror buttons. The mobile floating bar has its own
// light/dark + settings buttons so users don't have to fish for the desktop
// topbar (which is display:none on phones). They forward to the canonical
// handlers above so behavior stays in one place.
$('#btn-mode-mobile')?.addEventListener('click', () => $('#btn-mode').click());
$('#btn-settings-mobile')?.addEventListener('click', () => $('#btn-settings').click());
// Manual zoom buttons: adjust the multiplier on top of the fitted base.
// fit=false so subsequent applySettings calls don't snap back to 100%.
$('#btn-zoom-in').addEventListener('click', () => {
  settings.patch({ fit: false, zoom: Math.min(160, settings.get('zoom') + 10) });
  applyBoardSize();
});
$('#btn-zoom-out').addEventListener('click', () => {
  settings.patch({ fit: false, zoom: Math.max(60, settings.get('zoom') - 10) });
  applyBoardSize();
});
$('#btn-zoom-reset').addEventListener('click', () => {
  fitToScreen();
});

// Sync sound + scoreboard with persisted settings at boot. Music is wired
// up but only actually starts after the first user gesture ("Press Start"
// click) because the AudioContext can't be unlocked before that on iOS/Safari.
sound.enabled = settings.get('sfx');
sound.setVolume('musicVolume', settings.get('musicVolume'));
sound.setVolume('sfxVolume', settings.get('sfxVolume'));
scoreboard.setServer(settings.get('server'));

// ---------------------------------------------------------------------------
// Game-over dialog — collect identity, submit to server (or download local).
// ---------------------------------------------------------------------------
const goDialog = $('#gameover-dialog');
const goForm = $('#gameover-form');

function openGameOver() {
  // Prefill from last-known identity (saved on previous submit).
  const id = settings.get('identity') || {};
  goForm.elements.name.value = id.name || '';
  goForm.elements.tagline.value = id.tagline || '';
  goForm.elements.email.value = id.email || '';
  $('#go-score').textContent = engine.score.toLocaleString();
  $('#go-lines').textContent = engine.lines;
  $('#go-level').textContent = engine.level;
  $('#go-time').textContent = formatTime(engine.elapsedMs());
  // Tell the user whether they're getting a signed or unsigned receipt.
  // Tell the user what's about to happen + current connectivity status.
  const available = scoreboard.serverAvailable();
  $('#go-status').textContent = available
    ? "可提交到配置的排行榜；服务不可用时将保存本地成绩。下载本地成绩无需联网。"
    : "当前仅保存本地成绩，不提交排行榜。";
  goDialog.showModal();
}

// Submit handler — receives one of three intents from the form buttons:
//   submit  = sign + persist to server's public scoreboard
//   sign    = sign only (no public listing) and download
//   cancel  = close without action
goForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const intent = e.submitter?.value || 'cancel';
  if (intent === 'cancel') { goDialog.close('cancel'); return; }

  const fd = new FormData(goForm);
  const payload = {
    name: (fd.get('name') || '').toString().trim(),
    tagline: (fd.get('tagline') || '').toString().trim(),
    email: (fd.get('email') || '').toString().trim(),
    score: engine.score,
    lines: engine.lines,
    level: engine.level,
    duration_ms: Math.round(engine.elapsedMs()),
    pieces: stats.pieces,
    hard_drops: stats.hardDrops,
    soft_drops: stats.softDrops,
    rotations: stats.rotates,
    holds: stats.holds,
    tetrises: stats.tetrises,
    max_combo: stats.maxCombo,
    theme: settings.get('theme'),
    client_version: CLIENT_VERSION,
    played_at: new Date().toISOString(),
  };

  // Remember identity for next time so the player doesn't retype their name.
  settings.patch({ identity: { name: payload.name, tagline: payload.tagline, email: payload.email } });

  $('#go-status').textContent = '正在保存…';
  try {
    let result;
    if (intent === 'download') {
      scoreboard.saveLocal(payload);
      result = { offline: true, signed_txt: localReceiptInline(payload) };
    } else {
      result = await scoreboard.submit(payload, { store: intent === 'submit' });
    }
    downloadText(`tetris-${payload.name || 'anon'}-${payload.score}.txt`, result.signed_txt);
    if (result.offline) {
      $('#go-status').textContent = '本地成绩已下载，未提交排行榜。';
    } else if (result.accepted) {
      $('#go-status').textContent = `提交成功！排行榜名次：${result.rank ?? '暂无'}。`;
    } else {
      $('#go-status').textContent = '成绩已签名并下载。';
    }
    setTimeout(() => goDialog.close('done'), 1200);
  } catch (err) {
    // Network failure — gracefully degrade to an unsigned local receipt so the
    // player still gets something to show for their game.
    $('#go-status').textContent = '排行榜不可用，已改为保存本地成绩。';
    scoreboard.saveLocal(payload);
    downloadText(`tetris-${payload.name || 'anon'}-${payload.score}.txt`, localReceiptInline(payload));
  }
});

function localReceiptInline(p) {
  return `----- 俄罗斯成语方块儿成绩（本地，未签名）-----
昵称：${p.name}
留言：${p.tagline}
邮箱：${p.email}

分数：${p.score}
消除行数：${p.lines}
等级：${p.level}
时间：${formatTime(p.duration_ms)}
方块数：${p.pieces}
日期：${p.played_at}
主题：${({classic:"经典",color:"彩色",modern:"现代"})[p.theme] || p.theme}
版本：俄罗斯成语方块儿 ${p.client_version}
`;
}

// Standard "download a string as a file" recipe: Blob → object URL → <a download>.
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  // Free the blob URL after a short delay (the browser needs a moment to start the download).
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// "153000 ms" → "2:33"
function formatTime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
// Standard rAF loop. We compute `dt` (ms since last frame) and clamp it at
// 100 ms to prevent huge time jumps when the tab is backgrounded — without
// the clamp, returning to the tab after 30 seconds would drop the piece all
// the way to the floor in one tick.
let last = performance.now();
function loop(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (started) {
    // Always advance the frame clock above, but never accumulate gameplay
    // time during feedback. Renderer keeps its independent visual clock.
    if (!input.uiFrozen && !renderer.reward.freezing) engine.tick(dt);
    // Game-over detection — fire once when the engine flips the flag.
    if (engine.gameOver && !overlayEl.dataset.over) {
      overlayEl.dataset.over = '1';
      sound.setMusic(false);   // silence the loop so the dying-fall arpeggio plays clean
      sound.over();
      gameOverScreen();
    } else if (!engine.gameOver) {
      delete overlayEl.dataset.over;
    }
    // Play a line-clear SFX once per clear, then consume the flag.
    if (engine.lastClear) { sound.clear(engine.lastClear.n); engine.lastClear = null; }
  }
  trackPiece();
  renderer.draw(engine, input.uiFrozen ? 0 : dt);
  // HUD updates — cheap to do every frame because innerText only writes when changed.
  const scoreText = engine.score.toLocaleString();
  const timeText = formatTime(engine.elapsedMs());
  $('#stat-score').textContent = scoreText;
  $('#stat-lines').textContent = engine.lines;
  $('#stat-level').textContent = engine.level;
  $('#stat-time').textContent = timeText;
  // v1.5.0 — mirror into the mobile floating bar. These elements exist in the
  // DOM at all viewport sizes (CSS hides .mobile-bar on desktop), so writing
  // to them is harmless on desktop and live on phones.
  const mbScore = document.getElementById('mb-score');
  if (mbScore) mbScore.textContent = scoreText;
  const mbLevel = document.getElementById('mb-level');
  if (mbLevel) mbLevel.textContent = engine.level;
  const mbLines = document.getElementById('mb-lines');
  if (mbLines) mbLines.textContent = engine.lines;
  const mbTime = document.getElementById('mb-time');
  if (mbTime) mbTime.textContent = timeText;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------------------
// Service worker — offline support
// ---------------------------------------------------------------------------
// sw.js precaches the game shell. On first load (online), the SW installs
// and stocks the cache. On subsequent loads, the page works without network.
// We register on window 'load' (not DOMContentLoaded) so it doesn't compete
// with the initial render for resources.
if ('serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Async idiom loading may finish after the window load event.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
