import { useState, useEffect, useRef, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const CELL = 40;
const COLS = 22;
const ROWS = 14;
const CW = COLS * CELL;   // 880
const CH = ROWS * CELL;   // 560
const TOTAL_WAVES = 20;

// Path waypoints [col, row] – snake layout, 3 lanes
const WAYPOINTS = [
  [-1, 1], [20, 1],
  [20, 5], [1,  5],
  [1,  9], [20, 9],
  [20, 12],[COLS + 1, 12],
];

const cellCenter = ([c, r]) => [c * CELL + CELL / 2, r * CELL + CELL / 2];

// Pre-compute set of cells that are path (blocked for tower placement)
const PATH_CELLS = (() => {
  const s = new Set();
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [c1, r1] = WAYPOINTS[i], [c2, r2] = WAYPOINTS[i + 1];
    if (r1 === r2)
      for (let c = Math.min(c1,c2); c <= Math.max(c1,c2); c++) s.add(`${c},${r1}`);
    else
      for (let r = Math.min(r1,r2); r <= Math.max(r1,r2); r++) s.add(`${c1},${r}`);
  }
  return s;
})();

// ══════════════════════════════════════════════════════════════════════════════
//  TOWER DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════
const TOWERS = {
  archer: {
    name: "Archer", icon: "🏹", color: "#4ade80", dark: "#166534",
    cost: 75, sell: 0.6, desc: "Fast, medium range",
    levels: [
      { dmg: 14, rng: 105, spd: 1.2 },
      { dmg: 26, rng: 122, spd: 1.65, upgCost: 65 },
      { dmg: 44, rng: 145, spd: 2.1,  upgCost: 110 },
    ],
  },
  cannon: {
    name: "Cannon", icon: "💣", color: "#fb923c", dark: "#9a3412",
    cost: 130, sell: 0.6, desc: "Splash, slow fire",
    levels: [
      { dmg: 55, rng: 85, spd: 0.45, splash: 42 },
      { dmg: 95, rng: 98, spd: 0.62, splash: 58, upgCost: 110 },
      { dmg: 165, rng: 112, spd: 0.82, splash: 75, upgCost: 185 },
    ],
  },
  frost: {
    name: "Frost", icon: "❄️", color: "#38bdf8", dark: "#075985",
    cost: 110, sell: 0.6, desc: "Slows enemies",
    levels: [
      { dmg: 9,  rng: 125, spd: 0.85, slow: 0.50, slowDur: 2000 },
      { dmg: 16, rng: 145, spd: 1.05, slow: 0.40, slowDur: 2600, upgCost: 90  },
      { dmg: 25, rng: 168, spd: 1.30, slow: 0.30, slowDur: 3200, upgCost: 150 },
    ],
  },
  sniper: {
    name: "Sniper", icon: "🎯", color: "#c084fc", dark: "#4c1d95",
    cost: 160, sell: 0.6, desc: "Extreme range",
    levels: [
      { dmg: 95,  rng: 220, spd: 0.38 },
      { dmg: 170, rng: 265, spd: 0.53, upgCost: 135 },
      { dmg: 275, rng: 315, spd: 0.70, upgCost: 220 },
    ],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  ENEMY DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════
const ENEMIES = {
  basic: { hp: 80,  spd: 65,  reward: 10, color: "#f87171", r: 9  },
  fast:  { hp: 45,  spd: 120, reward: 15, color: "#facc15", r: 7  },
  tank:  { hp: 320, spd: 38,  reward: 30, color: "#94a3b8", r: 14 },
  boss:  { hp: 900, spd: 30,  reward: 75, color: "#a855f7", r: 18 },
};

// ══════════════════════════════════════════════════════════════════════════════
//  WAVE GENERATOR
// ══════════════════════════════════════════════════════════════════════════════
function buildWave(n) {
  const pool =
    n <= 2  ? ["basic"] :
    n <= 5  ? ["basic","basic","fast"] :
    n <= 9  ? ["basic","fast","tank"] :
              ["basic","fast","tank", n % 5 === 0 ? "boss" : "tank"];
  const count = 6 + n * 3;
  const gap   = Math.max(380, 1100 - n * 44);
  return Array.from({ length: count }, (_, i) => ({
    type: pool[Math.floor(Math.random() * pool.length)],
    delay: 400 + i * gap,
    spawned: false,
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function TowerDefense() {
  const cvs       = useRef(null);
  const wrapRef   = useRef(null);   // canvas wrapper, measured for responsive sizing
  const gs        = useRef(null);   // live game state (mutated in RAF loop)
  const rafId     = useRef(null);
  const lastTs    = useRef(0);
  const speedMult = useRef(1);
  const hoverCell = useRef(null);
  const selRef    = useRef(null);   // mirrors React sel state for use in RAF
  const flashRef  = useRef(0);      // wave-start flash timer
  const scaleRef  = useRef(1);      // device-pixel scale factor for crisp, responsive rendering

  // React state – only for UI re-renders
  const [sel, _setSel]    = useState(null);
  const [speed, setSpeed] = useState(1);
  const [ui, setUi]       = useState({
    money: 200, lives: 20, wave: 0,
    paused: false, gameOver: false, won: false, waveActive: false,
  });

  const setSel = (v) => { _setSel(v); selRef.current = v; };

  // ── Sync React UI from game state ─────────────────────────────────────────
  function syncUi() {
    const g = gs.current;
    if (!g) return;
    setUi({ money: g.money, lives: g.lives, wave: g.wave, paused: g.paused, gameOver: g.gameOver, won: g.won, waveActive: g.waveActive });
  }

  // ── Initialise / reset game state ─────────────────────────────────────────
  function initGame() {
    gs.current = {
      money: 200, lives: 20, wave: 0,
      paused: false, gameOver: false, won: false, waveActive: false,
      queue: [], qTimer: 0,
      enemies: [], towers: [], projs: [], parts: [],
      nid: 1,
    };
  }

  // ── Spawn one enemy ───────────────────────────────────────────────────────
  function spawnEnemy(g, type) {
    const d = ENEMIES[type];
    const scale = 1 + g.wave * 0.09;      // enemies scale with wave
    const [x, y] = cellCenter(WAYPOINTS[0]);
    g.enemies.push({
      id: g.nid++, type,
      hp: d.hp * scale, mhp: d.hp * scale,
      spd: d.spd, reward: d.reward,
      color: d.color, r: d.r,
      x, y, wp: 0, dist: 0,
      dead: false, done: false,
      slowM: 1, slowT: 0,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  UPDATE (called each frame)
  // ──────────────────────────────────────────────────────────────────────────
  function update(g, dt) {
    const s = dt / 1000;

    // ── Spawn queue ──
    if (g.waveActive) {
      g.qTimer += dt;
      let pending = false;
      for (const e of g.queue) {
        if (!e.spawned) {
          if (g.qTimer >= e.delay) { spawnEnemy(g, e.type); e.spawned = true; }
          else pending = true;
        }
      }
      if (!pending && g.enemies.length === 0) {
        g.waveActive = false;
        if (g.wave >= TOTAL_WAVES) { g.won = true; g.gameOver = true; }
      }
    }

    // ── Move enemies along path ──
    for (const e of g.enemies) {
      if (e.dead) continue;
      e.slowT = Math.max(0, e.slowT - dt);
      if (e.slowT === 0) e.slowM = 1;
      let mv = e.spd * e.slowM * s;
      while (mv > 0 && e.wp < WAYPOINTS.length - 1) {
        const [tx, ty] = cellCenter(WAYPOINTS[e.wp + 1]);
        const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
        if (mv >= d) {
          e.x = tx; e.y = ty; e.dist += d; mv -= d; e.wp++;
          if (e.wp >= WAYPOINTS.length - 1) { e.done = true; break; }
        } else {
          const f = mv / d;
          e.x += dx * f; e.y += dy * f; e.dist += mv; mv = 0;
        }
      }
    }

    // ── Collect dead / done ──
    g.enemies = g.enemies.filter(e => {
      if (e.done) { g.lives = Math.max(0, g.lives - 1); return false; }
      if (e.dead) return false;
      return true;
    });
    if (g.lives <= 0 && !g.gameOver) { g.gameOver = true; g.won = false; }

    // ── Tower attack logic ──
    for (const t of g.towers) {
      t.cd = Math.max(0, t.cd - dt);
      if (t.cd > 0) continue;
      const st = TOWERS[t.type].levels[t.lvl];
      // Target: furthest along path within range
      let tgt = null, bestD = -1;
      for (const e of g.enemies) {
        if (!e.dead && Math.hypot(e.x - t.x, e.y - t.y) <= st.rng && e.dist > bestD) {
          bestD = e.dist; tgt = e;
        }
      }
      if (!tgt) continue;
      t.cd = 1000 / st.spd;
      g.projs.push({
        id: g.nid++, type: t.type,
        x: t.x, y: t.y,
        tid: tgt.id, tx: tgt.x, ty: tgt.y,
        spd: t.type === "sniper" ? 440 : 270,
        dmg: st.dmg, splash: st.splash || 0,
        slow: st.slow || 0, slowDur: st.slowDur || 0,
        color: TOWERS[t.type].color, done: false,
      });
    }

    // ── Move projectiles ──
    for (const p of g.projs) {
      const tgt = g.enemies.find(e => e.id === p.tid);
      if (tgt && !tgt.dead) { p.tx = tgt.x; p.ty = tgt.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.spd * s;
      if (d <= step + 1) {
        p.done = true;
        if (p.splash > 0) {
          for (const e of g.enemies)
            if (!e.dead && Math.hypot(e.x - p.tx, e.y - p.ty) <= p.splash) damageEnemy(g, e, p.dmg);
          boom(g, p.tx, p.ty, "#fb923c");
        } else if (tgt && !tgt.dead) {
          damageEnemy(g, tgt, p.dmg);
          if (p.slow && !tgt.dead) { tgt.slowM = p.slow; tgt.slowT = p.slowDur; }
        }
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    g.projs = g.projs.filter(p => !p.done);

    // ── Particles ──
    for (const p of g.parts) {
      p.life -= dt; p.x += p.vx * s; p.y += p.vy * s;
      p.vy += 60 * s; // gravity
    }
    g.parts = g.parts.filter(p => p.life > 0);
  }

  function damageEnemy(g, e, dmg) {
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.dead = true;
      g.money += e.reward;
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, sp = 55 + Math.random() * 90;
        g.parts.push({ x: e.x, y: e.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 40, life: 550, color: e.color, r: 3 });
      }
      // Gold coin spark
      g.parts.push({ x: e.x, y: e.y - 4, vx: 0, vy: -90, life: 700, color: "#fbbf24", r: 4 });
    }
  }

  function boom(g, x, y, col) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.parts.push({ x, y, vx: Math.cos(a)*100, vy: Math.sin(a)*100, life: 500, color: col, r: 4 });
    }
    g.parts.push({ x, y, vx: 0, vy: 0, life: 180, color: "#fef3c7", r: 18 }); // flash
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────────────────────────────────────
  function render(canvas, g) {
    if (!canvas || !g) return;
    const ctx = canvas.getContext("2d");
    // Backing store may be larger than the logical CW×CH grid (responsive width
    // + devicePixelRatio upscaling) — scale so all existing draw calls, which
    // are written in logical CELL/CW/CH units, land on crisp physical pixels.
    ctx.setTransform(scaleRef.current, 0, 0, scaleRef.current, 0, 0);
    ctx.clearRect(0, 0, CW, CH);

    // ── Background ──
    ctx.fillStyle = "#0d1f0e";
    ctx.fillRect(0, 0, CW, CH);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c*CELL,0); ctx.lineTo(c*CELL,CH); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0,r*CELL); ctx.lineTo(CW,r*CELL); ctx.stroke(); }

    // ── Path cells ──
    for (const k of PATH_CELLS) {
      const [c, r] = k.split(",").map(Number);
      if (c < 0 || c >= COLS) continue;
      // Base dirt
      ctx.fillStyle = "#3d2f1e";
      ctx.fillRect(c*CELL, r*CELL, CELL, CELL);
      // Top layer
      ctx.fillStyle = "#5c4530";
      ctx.fillRect(c*CELL+1, r*CELL+1, CELL-2, CELL-2);
    }

    // Path arrows (direction hints)
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const [c1, r1] = WAYPOINTS[i], [c2, r2] = WAYPOINTS[i + 1];
      const dc = Math.sign(c2-c1), dr = Math.sign(r2-r1);
      const arrow = dc===1?"→":dc===-1?"←":dr===1?"↓":"↑";
      const mc = (c1+c2)/2, mr = (r1+r2)/2;
      if (mc >= 0 && mc < COLS && mr >= 0 && mr < ROWS) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillText(arrow, mc*CELL+CELL/2, mr*CELL+CELL/2);
      }
    }

    // Start / Base labels
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "#4ade80";
    ctx.textAlign = "left";
    ctx.fillText("▶ START", 4, CELL + CELL * 0.5 - 14);
    ctx.fillStyle = "#f87171";
    ctx.textAlign = "right";
    ctx.fillText("BASE ◀", CW - 4, 12*CELL + CELL*0.5 + 14);

    // ── Hover placement preview ──
    const hov = hoverCell.current;
    const cur = selRef.current;
    if (hov && cur?.kind === "place") {
      const key = `${hov.c},${hov.r}`;
      const occupied = g.towers.some(t => Math.floor(t.x/CELL)===hov.c && Math.floor(t.y/CELL)===hov.r);
      const valid = !PATH_CELLS.has(key) && hov.c>=0 && hov.c<COLS && hov.r>=0 && hov.r<ROWS && !occupied;
      ctx.fillStyle   = valid ? "rgba(74,222,128,0.18)" : "rgba(248,113,113,0.18)";
      ctx.strokeStyle = valid ? "#4ade80" : "#f87171";
      ctx.lineWidth = 2;
      ctx.fillRect(hov.c*CELL, hov.r*CELL, CELL, CELL);
      ctx.strokeRect(hov.c*CELL+1, hov.r*CELL+1, CELL-2, CELL-2);
      if (valid && cur.type) {
        const st = TOWERS[cur.type].levels[0];
        ctx.strokeStyle = TOWERS[cur.type].color + "44";
        ctx.lineWidth = 1;
        ctx.setLineDash([5,4]);
        ctx.beginPath();
        ctx.arc(hov.c*CELL+CELL/2, hov.r*CELL+CELL/2, st.rng, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Towers ──
    for (const t of g.towers) {
      const def = TOWERS[t.type];
      const st  = def.levels[t.lvl];
      const isSel = selRef.current?.kind==="tower" && selRef.current?.id===t.id;

      // Range ring when selected
      if (isSel) {
        ctx.strokeStyle = def.color + "30";
        ctx.lineWidth = 1;
        ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.arc(t.x, t.y, st.rng, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Platform
      ctx.fillStyle = isSel ? "#1e3a5f" : "#111827";
      ctx.strokeStyle = isSel ? def.color : "#374151";
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.beginPath(); ctx.arc(t.x, t.y, 17, 0, Math.PI*2); ctx.fill(); ctx.stroke();

      // Tower fill (gradient)
      const grd = ctx.createRadialGradient(t.x-4, t.y-4, 1, t.x, t.y, 13);
      grd.addColorStop(0, def.color);
      grd.addColorStop(1, def.dark);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(t.x, t.y, 13, 0, Math.PI*2); ctx.fill();

      // Upgrade dots
      const lvl = t.lvl;
      for (let i = 0; i <= lvl; i++) {
        const ox = (i - lvl/2) * 9;
        ctx.fillStyle = "#fbbf24";
        ctx.strokeStyle = "#78350f";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(t.x+ox, t.y+19, 3.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      }
    }

    // ── Projectiles ──
    for (const p of g.projs) {
      if (p.type === "sniper") {
        // Draw tracer line
        const ang = Math.atan2(p.ty-p.y, p.tx-p.x);
        ctx.strokeStyle = p.color + "66";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(ang)*24, p.y - Math.sin(ang)*24);
        ctx.stroke();
      }
      ctx.fillStyle = p.color;
      const r = p.type==="cannon" ? 5 : p.type==="sniper" ? 2 : 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
    }

    // ── Enemies ──
    for (const e of g.enemies) {
      if (e.dead) continue;
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(e.x, e.y+e.r, e.r*0.8, 3, 0, 0, Math.PI*2);
      ctx.fill();
      // Body
      const frozen = e.slowM < 1;
      ctx.fillStyle = frozen ? "#7dd3fc" : e.color;
      ctx.strokeStyle = frozen ? "#38bdf8" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      // Symbol
      if (e.type === "boss") {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.floor(e.r*0.85)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("★", e.x, e.y);
        ctx.textBaseline = "alphabetic";
      } else if (e.type === "tank") {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.floor(e.r*0.75)}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("▣", e.x, e.y);
        ctx.textBaseline = "alphabetic";
      }
      // HP bar
      const bw = e.r*2.6, bx = e.x-bw/2, by = e.y-e.r-9;
      ctx.fillStyle = "#111"; ctx.fillRect(bx-1, by-1, bw+2, 7);
      ctx.fillStyle = "#7f1d1d"; ctx.fillRect(bx, by, bw, 5);
      const pct = Math.max(0, e.hp/e.mhp);
      ctx.fillStyle = pct > 0.6 ? "#4ade80" : pct > 0.3 ? "#fb923c" : "#ef4444";
      ctx.fillRect(bx, by, bw*pct, 5);
    }

    // ── Particles ──
    for (const p of g.parts) {
      const alpha = Math.max(0, p.life / 550);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Wave-start flash ──
    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(251,191,36,${flashRef.current / 300 * 0.12})`;
      ctx.fillRect(0, 0, CW, CH);
      flashRef.current = Math.max(0, flashRef.current - 16);
    }

    // ── Pause overlay ──
    if (g.paused && !g.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(0, 0, CW, CH);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 50px 'Courier New',monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⏸  PAUSED", CW/2, CH/2);
      ctx.font = "16px monospace";
      ctx.fillStyle = "#64748b";
      ctx.fillText("Space or P to resume", CW/2, CH/2+52);
      ctx.textBaseline = "alphabetic";
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  GAME LOOP
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    initGame();
    syncUi();

    // ── Responsive, high-DPI canvas sizing ──
    // Renders the fixed CW×CH logical grid onto a backing store sized to the
    // wrapper's actual on-screen width × devicePixelRatio, so the board
    // stretches edge-to-edge with no leftover gap and stays sharp at any size.
    function resizeCanvas() {
      const wrap = wrapRef.current;
      const canvas = cvs.current;
      if (!wrap || !canvas) return;
      const aspect = CW / CH;
      const availW = Math.max(1, wrap.clientWidth);
      const availH = Math.max(1, wrap.clientHeight);
      // Fit the board into whatever space is left (fills width, but never grows
      // taller than the viewport allows — avoids forcing a page scroll).
      let displayWidth = availW;
      let displayHeight = displayWidth / aspect;
      if (displayHeight > availH) {
        displayHeight = availH;
        displayWidth = displayHeight * aspect;
      }
      displayWidth = Math.round(displayWidth);
      displayHeight = Math.round(displayHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pixelWidth = Math.round(displayWidth * dpr);
      const pixelHeight = Math.round(displayHeight * dpr);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      scaleRef.current = canvas.width / CW;
    }

    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resizeCanvas);

    function loop(ts) {
      const g = gs.current;
      const raw = ts - (lastTs.current || ts);
      lastTs.current = ts;
      const dt = Math.min(raw, 50) * speedMult.current;
      if (g && !g.paused && !g.gameOver) update(g, dt);
      render(cvs.current, g);
      syncUi();
      rafId.current = requestAnimationFrame(loop);
    }

    rafId.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId.current);
      ro.disconnect();
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []); // eslint-disable-line

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === " " || e.key === "p" || e.key === "P") {
        e.preventDefault();
        const g = gs.current;
        if (g && !g.gameOver) { g.paused = !g.paused; syncUi(); }
      }
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  //  CANVAS EVENTS
  // ──────────────────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    const c = cvs.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CW / rect.width);
    const my = (e.clientY - rect.top) * (CH / rect.height);
    hoverCell.current = { c: Math.floor(mx/CELL), r: Math.floor(my/CELL) };
  }, []);

  const onMouseLeave = useCallback(() => { hoverCell.current = null; }, []);

  const onCanvasClick = useCallback((e) => {
    const g = gs.current;
    if (!g || g.gameOver) return;
    const rect = cvs.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CW / rect.width);
    const my = (e.clientY - rect.top) * (CH / rect.height);
    const col = Math.floor(mx/CELL), row = Math.floor(my/CELL);
    const cur = selRef.current;

    // Click on existing tower → select it
    const twr = g.towers.find(t => Math.floor(t.x/CELL)===col && Math.floor(t.y/CELL)===row);
    if (twr) { setSel({ kind:"tower", id:twr.id }); return; }

    // Placement mode → place tower
    if (cur?.kind === "place") {
      const key = `${col},${row}`;
      const occupied = g.towers.some(t => Math.floor(t.x/CELL)===col && Math.floor(t.y/CELL)===row);
      if (PATH_CELLS.has(key) || col<0||col>=COLS||row<0||row>=ROWS||occupied) return;
      const def = TOWERS[cur.type];
      if (g.money < def.cost) return;
      g.money -= def.cost;
      g.towers.push({ id:g.nid++, type:cur.type, x:col*CELL+CELL/2, y:row*CELL+CELL/2, lvl:0, cd:0 });
      syncUi();
      return;
    }

    // Otherwise deselect
    setSel(null);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  //  ACTIONS
  // ──────────────────────────────────────────────────────────────────────────
  function doStartWave() {
    const g = gs.current;
    if (!g||g.waveActive||g.gameOver||g.wave>=TOTAL_WAVES) return;
    g.wave++;
    g.queue = buildWave(g.wave);
    g.qTimer = 0;
    g.waveActive = true;
    flashRef.current = 300;
    syncUi();
  }

  function doUpgrade() {
    const g = gs.current;
    const cur = selRef.current;
    if (!g||cur?.kind!=="tower") return;
    const t = g.towers.find(x=>x.id===cur.id);
    if (!t||t.lvl>=2) return;
    const cost = TOWERS[t.type].levels[t.lvl+1].upgCost;
    if (g.money<cost) return;
    g.money -= cost; t.lvl++;
    syncUi();
  }

  function doSell() {
    const g = gs.current;
    const cur = selRef.current;
    if (!g||cur?.kind!=="tower") return;
    const idx = g.towers.findIndex(x=>x.id===cur.id);
    if (idx<0) return;
    const t = g.towers[idx];
    const def = TOWERS[t.type];
    let val = Math.floor(def.cost * def.sell);
    for (let l=1;l<=t.lvl;l++) val += Math.floor((def.levels[l].upgCost||0)*def.sell);
    g.money += val;
    g.towers.splice(idx,1);
    setSel(null); syncUi();
  }

  function doRestart() {
    initGame(); lastTs.current=0; setSel(null); syncUi();
  }

  function doTogglePause() {
    const g = gs.current;
    if (!g||g.gameOver) return;
    g.paused = !g.paused; syncUi();
  }

  function doSetSpeed(v) {
    speedMult.current = v;
    setSpeed(v);
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  DERIVED UI VALUES
  // ──────────────────────────────────────────────────────────────────────────
  // Game state lives in a ref updated by the RAF loop; this read only maps selection → panel props.
  // eslint-disable-next-line react-hooks/refs -- intentional: imperative loop + syncUi() drives UI updates
  const selTwr  = sel?.kind==="tower" ? gs.current?.towers.find(t=>t.id===sel.id) : null;
  const selDef  = selTwr ? TOWERS[selTwr.type] : null;
  const selSt   = selTwr ? selDef.levels[selTwr.lvl] : null;
  const upgCost = selTwr&&selTwr.lvl<2 ? selDef.levels[selTwr.lvl+1].upgCost : null;
  const sellVal = selTwr ? (() => {
    const d = selDef; let v = Math.floor(d.cost*d.sell);
    for (let l=1;l<=selTwr.lvl;l++) v+=Math.floor((d.levels[l].upgCost||0)*d.sell);
    return v;
  })() : 0;

  // ──────────────────────────────────────────────────────────────────────────
  //  RENDER UI
  // ──────────────────────────────────────────────────────────────────────────
  const lifeDanger = ui.lives <= 5;

  return (
    <div style={{
      background: "#050d06",
      height: "100vh",
      overflow: "auto",
      display: "flex", flexDirection: "column", alignItems: "stretch",
      padding: "10px 20px 16px",
      boxSizing: "border-box",
      fontFamily: "'Courier New', monospace",
      color: "#e2e8f0",
      gap: "8px",
    }}>

      {/* ── TOP STATS BAR ── */}
      <div style={{ display:"flex", gap:"10px", alignItems:"center", flexWrap:"wrap", justifyContent:"center", flexShrink:0 }}>
        {/* Stats panel */}
        <div style={{
          background: "#0a1a0b", border: "1px solid #1e3a20",
          borderRadius: "8px", padding: "8px 20px",
          display: "flex", gap: "24px", alignItems: "center",
        }}>
          <StatBox icon="❤" label="LIVES" value={ui.lives}
            color={lifeDanger ? "#ef4444" : "#4ade80"}
            pulse={lifeDanger} />
          <StatBox icon="◈" label="GOLD"  value={`$${ui.money}`} color="#fbbf24" />
          <StatBox icon="◉" label="WAVE"  value={`${ui.wave} / ${TOTAL_WAVES}`} color="#38bdf8" />
        </div>

        {/* Controls */}
        <div style={{ display:"flex", gap:"6px" }}>
          <Btn onClick={doTogglePause} active={ui.paused} activeColor="#16a34a" baseColor="#1e3a20">
            {ui.paused ? "▶ RESUME" : "⏸ PAUSE"}
          </Btn>
          <Btn onClick={() => doSetSpeed(1)} active={speed===1} activeColor="#1d4ed8" baseColor="#1e293b">1×</Btn>
          <Btn onClick={() => doSetSpeed(2)} active={speed===2} activeColor="#1d4ed8" baseColor="#1e293b">2×</Btn>
          <Btn onClick={doRestart} baseColor="#450a0a" hoverColor="#7f1d1d">↺ RESET</Btn>
        </div>
      </div>

      {/* ── CANVAS ── */}
      <div ref={wrapRef} style={{
        flex:"1 1 auto", minHeight:0, minWidth:0,
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
      <div style={{ position:"relative", lineHeight:0 }}>
        <canvas
          ref={cvs}
          width={CW} height={CH}
          onClick={onCanvasClick}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          style={{
            display: "block", borderRadius: "8px",
            border: "1px solid #1e3a20",
            cursor: sel?.kind==="place" ? "crosshair" : "pointer",
          }}
        />

        {/* Game-over overlay */}
        {ui.gameOver && (
          <div style={{
            position:"absolute", inset:0, borderRadius:"8px",
            background: "rgba(0,0,0,0.82)",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"12px",
          }}>
            <div style={{ fontSize:"56px" }}>{ui.won ? "🏆" : "💀"}</div>
            <div style={{
              fontSize:"32px", fontWeight:900, letterSpacing:"0.05em",
              color: ui.won ? "#fbbf24" : "#ef4444",
            }}>
              {ui.won ? "VICTORY" : "DEFEATED"}
            </div>
            <div style={{ color:"#64748b", fontSize:"14px" }}>
              {ui.won ? `All ${TOTAL_WAVES} waves repelled.` : `Base fell on wave ${ui.wave}.`}
            </div>
            <button onClick={doRestart} style={{
              marginTop:"8px", padding:"11px 32px",
              background:"#1d4ed8", color:"#fff", border:"none",
              borderRadius:"6px", cursor:"pointer", fontWeight:700,
              fontSize:"15px", fontFamily:"inherit", letterSpacing:"0.05em",
            }}>PLAY AGAIN</button>
          </div>
        )}
      </div>
      </div>

      {/* ── BOTTOM TOOLBAR ── */}
      <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", justifyContent:"center", alignItems:"flex-start", flexShrink:0 }}>

        {/* Tower shop */}
        <Panel title="BUILD TOWERS">
          <div style={{ display:"flex", gap:"6px" }}>
            {Object.entries(TOWERS).map(([type, def]) => {
              const active = sel?.kind==="place" && sel.type===type;
              const afford = ui.money >= def.cost;
              return (
                <button key={type}
                  onClick={() => setSel(active ? null : { kind:"place", type })}
                  style={{
                    background: active ? "#1e3a5f" : afford ? "#0f1f10" : "#0a0f0a",
                    border: `1.5px solid ${active ? def.color : afford ? def.color+"55" : "#1e293b"}`,
                    borderRadius:"7px", color: afford ? "#e2e8f0" : "#475569",
                    cursor:"pointer", padding:"8px 10px",
                    display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
                    minWidth:"76px", fontFamily:"inherit", opacity: afford ? 1 : 0.55,
                    transition:"all 0.15s",
                  }}>
                  <span style={{ fontSize:"20px", lineHeight:1 }}>{def.icon}</span>
                  <span style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.05em" }}>{def.name.toUpperCase()}</span>
                  <span style={{ fontSize:"11px", color:"#fbbf24" }}>${def.cost}</span>
                  <span style={{ fontSize:"10px", color:"#64748b", textAlign:"center", lineHeight:"1.3" }}>{def.desc}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Selected tower panel */}
        {selTwr && selDef && selSt && (
          <Panel title={`${selDef.name.toUpperCase()} — LV ${selTwr.lvl+1}`} color={selDef.color}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
              <span style={{ fontSize:"28px" }}>{selDef.icon}</span>
              <div style={{ color:"#fbbf24", fontSize:"14px", letterSpacing:"3px" }}>
                {"★".repeat(selTwr.lvl+1)}{"☆".repeat(2-selTwr.lvl)}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"auto auto", gap:"3px 16px", fontSize:"12px", marginBottom:"10px" }}>
              <KV k="DMG"   v={selSt.dmg} />
              <KV k="RANGE" v={`${selSt.rng}px`} />
              <KV k="RATE"  v={`${selSt.spd.toFixed(1)}/s`} />
              {selSt.splash && <KV k="SPLASH" v={`${selSt.splash}px`} />}
              {selSt.slow   && <KV k="SLOW"   v={`${((1-selSt.slow)*100).toFixed(0)}%`} />}
            </div>
            <div style={{ display:"flex", gap:"6px" }}>
              {selTwr.lvl < 2 ? (
                <button
                  onClick={doUpgrade}
                  disabled={ui.money < upgCost}
                  style={{
                    flex:1, padding:"7px 0",
                    background: ui.money >= upgCost ? "#14532d" : "#0a1a10",
                    border:"1px solid " + (ui.money >= upgCost ? "#4ade80" : "#1e3a20"),
                    color: ui.money >= upgCost ? "#4ade80" : "#374151",
                    borderRadius:"6px", cursor: ui.money >= upgCost ? "pointer" : "not-allowed",
                    fontFamily:"inherit", fontSize:"12px", fontWeight:700,
                  }}>
                  ⬆ UPGRADE ${upgCost}
                </button>
              ) : (
                <div style={{
                  flex:1, textAlign:"center", fontSize:"11px",
                  color:"#fbbf24", padding:"7px", background:"#1c1500",
                  border:"1px solid #713f12", borderRadius:"6px", letterSpacing:"0.05em",
                }}>✦ MAX LEVEL</div>
              )}
              <button onClick={doSell} style={{
                padding:"7px 12px", background:"#450a0a",
                border:"1px solid #7f1d1d", color:"#fca5a5",
                borderRadius:"6px", cursor:"pointer",
                fontFamily:"inherit", fontSize:"12px", fontWeight:700,
              }}>SELL ${sellVal}</button>
            </div>
          </Panel>
        )}

        {/* Wave control */}
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          <button
            onClick={doStartWave}
            disabled={ui.waveActive||ui.gameOver||ui.wave>=TOTAL_WAVES}
            style={{
              padding:"12px 22px",
              background: (!ui.waveActive&&!ui.gameOver&&ui.wave<TOTAL_WAVES) ? "#92400e" : "#1a1a1a",
              border: "1px solid " + ((!ui.waveActive&&!ui.gameOver&&ui.wave<TOTAL_WAVES) ? "#f59e0b" : "#374151"),
              color: (!ui.waveActive&&!ui.gameOver&&ui.wave<TOTAL_WAVES) ? "#fcd34d" : "#4b5563",
              borderRadius:"7px", cursor: (!ui.waveActive&&!ui.gameOver&&ui.wave<TOTAL_WAVES) ? "pointer" : "default",
              fontFamily:"inherit", fontSize:"14px", fontWeight:900, letterSpacing:"0.08em",
              opacity: (ui.waveActive||ui.gameOver) ? 0.5 : 1,
            }}>
            {ui.waveActive
              ? `WAVE ${ui.wave} INCOMING…`
              : ui.wave >= TOTAL_WAVES
                ? "ALL WAVES DONE 🏆"
                : `▶ SEND WAVE ${ui.wave+1}`}
          </button>
          {!ui.waveActive && ui.wave<TOTAL_WAVES && !ui.gameOver && (
            <div style={{ fontSize:"10px", color:"#374151", textAlign:"center" }}>
              Place towers, then send the wave
            </div>
          )}
        </div>
      </div>

      {/* ── LEGEND ── */}
      <div style={{ display:"flex", gap:"14px", fontSize:"10px", color:"#334155", flexWrap:"wrap", justifyContent:"center", marginTop:"2px", flexShrink:0 }}>
        {Object.entries(ENEMIES).map(([type, d]) => (
          <div key={type} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:d.color, flexShrink:0 }}/>
            <span>{type.toUpperCase()} +${d.reward}</span>
          </div>
        ))}
        <span style={{ color:"#1e293b" }}>| SPACE/P=pause | ESC=deselect</span>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StatBox({ icon, label, value, color, pulse }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:"10px", color:"#4b5563", letterSpacing:"0.1em" }}>{icon} {label}</div>
      <div style={{
        fontSize:"20px", fontWeight:900, color,
        animation: pulse ? "pulse 1s infinite" : "none",
      }}>{value}</div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.55}}`}</style>
    </div>
  );
}

function Btn({ children, onClick, active, activeColor="#1d4ed8", baseColor="#1e293b" }) {
  return (
    <button onClick={onClick} style={{
      padding:"7px 14px",
      background: active ? activeColor : baseColor,
      border: `1px solid ${active ? activeColor : "#334155"}`,
      color: "#e2e8f0", borderRadius:"6px", cursor:"pointer",
      fontFamily:"inherit", fontWeight:700, fontSize:"12px",
      letterSpacing:"0.05em",
    }}>{children}</button>
  );
}

function Panel({ title, children, color }) {
  return (
    <div style={{
      background:"#0a1a0b",
      border:`1px solid ${color ? color+"33" : "#1e3a20"}`,
      borderRadius:"8px", padding:"10px 12px",
    }}>
      <div style={{
        fontSize:"10px", fontWeight:700, color:"#4b5563",
        letterSpacing:"0.1em", marginBottom:"8px",
      }}>{title}</div>
      {children}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <>
      <span style={{ color:"#4b5563", letterSpacing:"0.05em" }}>{k}</span>
      <span style={{ color:"#e2e8f0" }}>{v}</span>
    </>
  );
}
