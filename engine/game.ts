/* =========================================================================
   GAME LOGIC — pure grid simulation. Emits events; never touches the DOM.
   ========================================================================= */
import { CONFIG, DX, DY, PU_TYPES, TAU, type GameMode, type PowerUpType } from './config';

export interface Cell { x: number; y: number }
export interface Food extends Cell { px: number; py: number; golden: boolean; life: number; age: number; seed: number }
export interface Item extends Cell { type: PowerUpType; life: number; age: number; seed: number }
export interface Obstacle extends Cell { age: number }
export interface Layout { x: number; y: number; cell: number; w: number; h: number }
export interface Face {
  blink: number; blinkT: number; nextBlink: number;
  tongue: number; nextTongue: number;
  mouth: number; widen: number; turn: number; lx: number; ly: number;
}

export interface GameEvents {
  onEat?(g: Game, f: Food, pts: number, combo: number, mult: number): void;
  onLevel?(g: Game, level: number): void;
  onPowerUp?(g: Game, type: PowerUpType, it: Item): void;
  onPowerEnd?(g: Game, type: PowerUpType): void;
  onExpire?(g: Game, obj: Food | Item): void;
  onObstacle?(g: Game, o: Obstacle): void;
  onDie?(g: Game, reason: string): void;
}

export class Game {
  readonly cols: number;
  readonly rows: number;
  readonly mode: GameMode;
  readonly n: number;
  readonly demo: boolean;
  events: GameEvents;

  readonly snakeCount: Uint16Array;   // body segments per cell (can be >1 while Ghost)
  readonly blocked: Uint8Array;       // obstacles
  private readonly seen: Uint8Array;  // BFS scratch
  private readonly bfsQ: Int32Array;
  private readonly parent: Int32Array;
  readonly prevX: Float32Array;       // positions before the last step (for interpolation)
  readonly prevY: Float32Array;
  readonly L: Layout = { x: 0, y: 0, cell: 24, w: 0, h: 0 };   // screen layout, owned by the renderer
  readonly face: Face = { blink: 0, blinkT: 0, nextBlink: 1600, tongue: 0, nextTongue: 2400, mouth: 0, widen: 0, turn: 0, lx: 1, ly: 0 };

  body: Cell[] = [];
  dir = 1;
  prevDir = 1;
  queue: number[] = [];
  foods: Food[] = [];
  items: Item[] = [];
  obstacles: Obstacle[] = [];
  active: Record<PowerUpType, number> = { slow: 0, ghost: 0, magnet: 0, double: 0 };
  score = 0; eaten = 0; level = 1; combo = 0; lastEat = -1e9;
  time = 0; ticks = 0; alive = true; grow = 0;
  bulges: number[] = [];
  foodsSincePU = 0;
  deathReason = '';

  constructor(cols: number, rows: number, mode: GameMode, opts: { events?: GameEvents; demo?: boolean } = {}) {
    this.cols = cols; this.rows = rows; this.mode = mode;
    this.n = cols * rows;
    this.demo = !!opts.demo;
    this.events = opts.events || {};
    const n = this.n;
    this.snakeCount = new Uint16Array(n);
    this.blocked = new Uint8Array(n);
    this.seen = new Uint8Array(n);
    this.bfsQ = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.prevX = new Float32Array(n + 2);
    this.prevY = new Float32Array(n + 2);
    this.reset();
  }

  reset() {
    const len = CONFIG.snake.startLength, cols = this.cols;
    this.snakeCount.fill(0); this.blocked.fill(0);
    this.body = [];
    const sy = Math.floor(this.rows / 2), sx = Math.max(len - 1, Math.floor(cols * 0.3));
    for (let i = 0; i < len; i++) {
      const c = { x: sx - i, y: sy };
      this.body.push(c);
      this.snakeCount[c.y * cols + c.x]++;
      this.prevX[i] = c.x; this.prevY[i] = c.y;
    }
    this.dir = 1; this.prevDir = 1; this.queue = [];
    this.foods = []; this.items = []; this.obstacles = [];
    this.active = { slow: 0, ghost: 0, magnet: 0, double: 0 };
    this.score = 0; this.eaten = 0; this.level = 1; this.combo = 0; this.lastEat = -1e9;
    this.time = 0; this.ticks = 0; this.alive = true; this.grow = 0; this.bulges = [];
    this.foodsSincePU = 0; this.deathReason = '';
    if (this.mode === 'arcade') this.addObstacles(CONFIG.obstacles.start, true);
    this.spawnFood(false);
  }

  get wrapsBoard() { return this.mode === 'zen' || this.mode === 'demo'; }
  get wraps() { return this.wrapsBoard || this.active.ghost > 0; }

  tickMs() {
    const s = CONFIG.speed[this.mode];
    let ms = Math.max(s.min, s.base - (this.level - 1) * s.perLevel);
    if (this.active.slow > 0) ms *= CONFIG.powerUps.slowFactor;
    return ms;
  }

  /* Buffered input: up to N turns, ignoring repeats and 180° reversals */
  queueDir(d: number) {
    if (!this.alive) return false;
    const q = this.queue, last = q.length ? q[q.length - 1] : this.dir;
    if (d === last || d === (last + 2) % 4 || q.length >= CONFIG.input.bufferSize) return false;
    q.push(d);
    return true;
  }

  foodAt(x: number, y: number): Food | null {
    for (let i = 0; i < this.foods.length; i++) { const f = this.foods[i]; if (f.x === x && f.y === y) return f; }
    return null;
  }
  itemAt(x: number, y: number): Item | null {
    for (let i = 0; i < this.items.length; i++) { const t = this.items[i]; if (t.x === x && t.y === y) return t; }
    return null;
  }
  hasGolden() { for (let i = 0; i < this.foods.length; i++) if (this.foods[i].golden) return true; return false; }
  hasNormal() { for (let i = 0; i < this.foods.length; i++) if (!this.foods[i].golden) return true; return false; }

  /* Is there food / a power-up in the cell the head will enter next? (drives the open mouth) */
  foodAhead() {
    const h = this.body[0], d = this.queue.length ? this.queue[0] : this.dir;
    let x = h.x + DX[d], y = h.y + DY[d];
    if (this.wraps) { x = (x + this.cols) % this.cols; y = (y + this.rows) % this.rows; }
    return !!(this.foodAt(x, y) || this.itemAt(x, y));
  }

  /* ---- One grid step ---- */
  step() {
    if (!this.alive) return;
    const b = this.body, cols = this.cols, rows = this.rows;
    this.ticks++;
    for (let i = 0; i < b.length; i++) { this.prevX[i] = b[i].x; this.prevY[i] = b[i].y; }
    for (let i = 0; i < this.foods.length; i++) { const f = this.foods[i]; f.px = f.x; f.py = f.y; }
    this.prevDir = this.dir;
    if (this.queue.length) {
      const d = this.queue.shift()!;
      if (d !== this.dir && d !== (this.dir + 2) % 4) { this.dir = d; this.face.turn = 1; }
    }
    const head = b[0];
    let nx = head.x + DX[this.dir], ny = head.y + DY[this.dir];
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      if (!this.wraps) return this.die('wall');
      nx = (nx + cols) % cols; ny = (ny + rows) % rows;
    }
    const ni = ny * cols + nx;
    const food = this.foodAt(nx, ny);
    const growing = (this.grow > 0 || !!food) && !(this.demo && b.length >= CONFIG.snake.demoMaxLength);
    if (this.active.ghost <= 0) {
      if (this.blocked[ni]) return this.die('obstacle');
      if (this.snakeCount[ni] > 0) {
        const t = b[b.length - 1];
        const tailMovesAway = t.x === nx && t.y === ny && !growing && this.snakeCount[ni] === 1;
        if (!tailMovesAway) return this.die('self');
      }
    }
    let seg: Cell;
    if (growing) {
      const t = b[b.length - 1];
      this.prevX[b.length] = t.x; this.prevY[b.length] = t.y;   // new tail segment stays put
      seg = { x: nx, y: ny };
      if (!food && this.grow > 0) this.grow--;
    } else {
      seg = b.pop()!;                                            // recycle the tail object
      this.snakeCount[seg.y * cols + seg.x]--;
      seg.x = nx; seg.y = ny;
    }
    b.unshift(seg);
    this.snakeCount[ni]++;
    while (this.bulges.length && (this.ticks - this.bulges[0]) * CONFIG.render.bulgeSpeed > b.length + 2) this.bulges.shift();
    if (food) this.eat(food);
    const it = this.itemAt(nx, ny);
    if (it) this.collect(it);
    if (this.active.magnet > 0) this.magnetPull();
  }

  /* ---- Real-time timers (independent of step speed) ---- */
  update(dt: number) {
    if (!this.alive) return;
    this.time += dt;
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (f.golden && (f.life -= dt) <= 0) { this.foods.splice(i, 1); this.events.onExpire?.(this, f); }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if ((it.life -= dt) <= 0) { this.items.splice(i, 1); this.events.onExpire?.(this, it); }
    }
    const a = this.active;
    for (let k = 0; k < PU_TYPES.length; k++) {
      const t = PU_TYPES[k];
      if (a[t] <= 0) continue;
      a[t] -= dt;
      if (a[t] <= 0) {
        // Ghost never ends while the head is inside the body or a rock — fairness first
        if (t === 'ghost' && this.headInsideSomething()) { a[t] = 1; continue; }
        a[t] = 0;
        this.events.onPowerEnd?.(this, t);
      }
    }
  }

  private headInsideSomething() {
    const h = this.body[0], i = h.y * this.cols + h.x;
    return this.snakeCount[i] > 1 || this.blocked[i] > 0;
  }

  private eat(f: Food) {
    this.foods.splice(this.foods.indexOf(f), 1);
    this.eaten++;
    this.combo = this.time - this.lastEat <= CONFIG.combo.windowMs ? this.combo + 1 : 1;
    this.lastEat = this.time;
    const mult = Math.min(this.combo, CONFIG.combo.maxMult) * (this.active.double > 0 ? 2 : 1);
    const pts = (f.golden ? CONFIG.food.goldenPoints : CONFIG.food.points) * mult;
    this.score += pts;
    if (f.golden) this.grow += CONFIG.food.goldenGrow - 1;
    if (this.bulges.length < 6) this.bulges.push(this.ticks);
    this.events.onEat?.(this, f, pts, this.combo, mult);
    if (!this.demo) {
      const lvl = 1 + Math.floor(this.eaten / CONFIG.speed.foodsPerLevel);
      if (lvl > this.level) {
        this.level = lvl;
        if (this.mode === 'arcade') this.addObstacles(CONFIG.obstacles.perLevel, false);
        this.events.onLevel?.(this, lvl);
      }
    }
    if (!this.hasNormal()) this.spawnFood(false);
    if (!f.golden && !this.hasGolden() && Math.random() < CONFIG.food.goldenChance) this.spawnFood(true);
    if (this.mode === 'arcade') {
      this.foodsSincePU++;
      if (!this.items.length && this.foodsSincePU >= CONFIG.powerUps.minFoodsBetween && Math.random() < CONFIG.powerUps.spawnChance) this.spawnPowerUp();
    }
  }

  private collect(it: Item) {
    this.items.splice(this.items.indexOf(it), 1);
    this.active[it.type] = CONFIG.powerUps.durationMs;
    this.events.onPowerUp?.(this, it.type, it);
  }

  die(reason: string) {
    this.alive = false;
    this.deathReason = reason;
    this.events.onDie?.(this, reason);
  }

  /* ---- Fair spawning: free, not near the head, reachable, not a dead-end ---- */
  private flood(ignoreSnake: boolean) {
    const cols = this.cols, rows = this.rows, seen = this.seen, q = this.bfsQ, wrap = this.wrapsBoard;
    seen.fill(0);
    const h = this.body[0], hi = h.y * cols + h.x;
    let qh = 0, qt = 0;
    seen[hi] = 1; q[qt++] = hi;
    while (qh < qt) {
      const c = q[qh++], cx = c % cols, cy = (c / cols) | 0;
      for (let d = 0; d < 4; d++) {
        let x = cx + DX[d], y = cy + DY[d];
        if (x < 0 || y < 0 || x >= cols || y >= rows) { if (!wrap) continue; x = (x + cols) % cols; y = (y + rows) % rows; }
        const i = y * cols + x;
        if (seen[i] || this.blocked[i] || (!ignoreSnake && this.snakeCount[i])) continue;
        seen[i] = 1; q[qt++] = i;
      }
    }
    return qt;
  }

  private freeNeighbours(x: number, y: number) {
    let n = 0;
    for (let d = 0; d < 4; d++) {
      let ax = x + DX[d], ay = y + DY[d];
      if (ax < 0 || ay < 0 || ax >= this.cols || ay >= this.rows) {
        if (!this.wrapsBoard) continue;
        ax = (ax + this.cols) % this.cols; ay = (ay + this.rows) % this.rows;
      }
      const i = ay * this.cols + ax;
      if (!this.blocked[i] && !this.snakeCount[i]) n++;
    }
    return n;
  }

  private pickCell(minDist: number, strict: boolean) {
    const cols = this.cols, rows = this.rows, h = this.body[0], wrap = this.wrapsBoard;
    let chosen = -1, count = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.seen[i] || this.snakeCount[i] || this.blocked[i]) continue;
      const x = i % cols, y = (i / cols) | 0;
      let dx = Math.abs(x - h.x), dy = Math.abs(y - h.y);
      if (wrap) { dx = Math.min(dx, cols - dx); dy = Math.min(dy, rows - dy); }
      if (dx + dy < minDist) continue;
      if (this.foodAt(x, y) || this.itemAt(x, y)) continue;
      if (strict && this.freeNeighbours(x, y) < 2) continue;
      count++;
      if (Math.random() * count < 1) chosen = i;          // reservoir sampling, no allocations
    }
    return chosen;
  }

  private findSpawn(minDist: number) {
    this.flood(false);
    let i = this.pickCell(minDist, true);
    if (i < 0) i = this.pickCell(2, false);
    if (i < 0) i = this.pickCell(1, false);
    return i;
  }

  spawnFood(golden: boolean): Food | null {
    const i = this.findSpawn(CONFIG.food.minHeadDist);
    if (i < 0) return null;
    const x = i % this.cols, y = (i / this.cols) | 0;
    const f: Food = { x, y, px: x, py: y, golden, life: golden ? CONFIG.food.goldenLifeMs : 0, age: 0, seed: Math.random() * TAU };
    this.foods.push(f);
    return f;
  }

  spawnPowerUp() {
    const i = this.findSpawn(4);
    if (i < 0) return;
    const type = PU_TYPES[(Math.random() * PU_TYPES.length) | 0];
    this.items.push({ x: i % this.cols, y: (i / this.cols) | 0, type, life: CONFIG.powerUps.boardLifeMs, age: 0, seed: Math.random() * TAU });
    this.foodsSincePU = 0;
  }

  /* Obstacles never split the board, never sit in the lane ahead, never create dead-ends */
  addObstacles(count: number, initial: boolean) {
    const cols = this.cols, rows = this.rows;
    for (let k = 0; k < count && this.obstacles.length < CONFIG.obstacles.max; k++) {
      const h = this.body[0];
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = (Math.random() * cols) | 0, y = (Math.random() * rows) | 0, i = y * cols + x;
        if (this.blocked[i] || this.snakeCount[i] || this.foodAt(x, y) || this.itemAt(x, y)) continue;
        if (Math.abs(x - h.x) + Math.abs(y - h.y) < 5) continue;
        if (initial && Math.abs(y - h.y) <= 1) continue;
        if (this.inLaneAhead(x, y)) continue;
        this.blocked[i] = 1;
        const ok = this.flood(true) === this.n - this.obstacles.length - 1 && this.neighboursStayOpen(x, y);
        if (ok) {
          const o: Obstacle = { x, y, age: 0 };
          this.obstacles.push(o);
          if (!initial) this.events.onObstacle?.(this, o);
          break;
        }
        this.blocked[i] = 0;
      }
    }
  }

  private inLaneAhead(x: number, y: number) {
    const h = this.body[0];
    for (let s = 1; s <= CONFIG.obstacles.safeAhead; s++) {
      const ax = h.x + DX[this.dir] * s, ay = h.y + DY[this.dir] * s;
      if (Math.abs(ax - x) <= 1 && Math.abs(ay - y) <= 1) return true;
    }
    return false;
  }

  private neighboursStayOpen(x: number, y: number) {
    for (let d = 0; d < 4; d++) {
      const ax = x + DX[d], ay = y + DY[d];
      if (ax < 0 || ay < 0 || ax >= this.cols || ay >= this.rows) continue;
      if (this.blocked[ay * this.cols + ax]) continue;
      let open = 0;
      for (let e = 0; e < 4; e++) {
        const bx = ax + DX[e], by = ay + DY[e];
        if (bx < 0 || by < 0 || bx >= this.cols || by >= this.rows) continue;
        if (!this.blocked[by * this.cols + bx]) open++;
      }
      if (open < 2) return false;
    }
    return true;
  }

  /* Magnet: nearby food slides one cell toward the head each step */
  private magnetPull() {
    const h = this.body[0], R = CONFIG.powerUps.magnetRadius;
    for (let k = 0; k < this.foods.length; k++) {
      const f = this.foods[k];
      const dx = h.x - f.x, dy = h.y - f.y, dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= 1 || dist > R) continue;
      const sx = Math.sign(dx), sy = Math.sign(dy), xFirst = Math.abs(dx) >= Math.abs(dy);
      if (!this.tryMoveFood(f, xFirst ? sx : 0, xFirst ? 0 : sy)) this.tryMoveFood(f, xFirst ? 0 : sx, xFirst ? sy : 0);
    }
  }

  private tryMoveFood(f: Food, mx: number, my: number) {
    if (!mx && !my) return false;
    const x = f.x + mx, y = f.y + my;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    const i = y * this.cols + x;
    if (this.blocked[i] || this.snakeCount[i] || this.foodAt(x, y) || this.itemAt(x, y)) return false;
    f.x = x; f.y = y;
    return true;
  }

  /* ---- Demo AI (home screen): BFS to food, fall back to the move with the most room ---- */
  aiStep() {
    const d = this.aiDir();
    this.queue.length = 0;
    if (d >= 0 && d !== this.dir && d !== (this.dir + 2) % 4) this.queue.push(d);
    this.step();
  }

  private aiDir() {
    const cols = this.cols, rows = this.rows, h = this.body[0], hi = h.y * cols + h.x;
    const seen = this.seen, q = this.bfsQ, par = this.parent;
    const target = this.foods.length ? this.foods[0].y * cols + this.foods[0].x : -1;
    seen.fill(0);
    let qh = 0, qt = 0, found = -1;
    seen[hi] = 1; par[hi] = -1; q[qt++] = hi;
    while (qh < qt) {
      const c = q[qh++];
      if (c === target) { found = c; break; }
      const cx = c % cols, cy = (c / cols) | 0;
      for (let d = 0; d < 4; d++) {
        const x = (cx + DX[d] + cols) % cols, y = (cy + DY[d] + rows) % rows, i = y * cols + x;
        if (seen[i] || this.blocked[i] || this.snakeCount[i]) continue;
        seen[i] = 1; par[i] = c; q[qt++] = i;
      }
    }
    let best = -1;
    if (found >= 0 && found !== hi) {
      let c = found;
      while (par[c] !== hi && par[c] !== -1) c = par[c];
      best = this.dirTo(hi, c);
    }
    if (Math.random() < 0.08) best = -1;                         // a little wandering looks alive
    const len = this.body.length;
    if (best < 0 || this.spaceAfter(best) < len) {
      let bestSpace = -1;
      for (let d = 0; d < 4; d++) {
        if (d === (this.dir + 2) % 4) continue;
        const s = this.spaceAfter(d) + Math.random() * 0.5;
        if (s > bestSpace) { bestSpace = s; best = d; }
      }
    }
    return best;
  }

  private dirTo(a: number, b: number) {
    const cols = this.cols, rows = this.rows;
    const dx = (b % cols) - (a % cols), dy = ((b / cols) | 0) - ((a / cols) | 0);
    if (dx === 1 || dx === -(cols - 1)) return 1;
    if (dx === -1 || dx === cols - 1) return 3;
    if (dy === 1 || dy === -(rows - 1)) return 2;
    return 0;
  }

  private spaceAfter(d: number) {
    const cols = this.cols, rows = this.rows, h = this.body[0];
    const x0 = (h.x + DX[d] + cols) % cols, y0 = (h.y + DY[d] + rows) % rows, s = y0 * cols + x0;
    if (this.blocked[s]) return -1;
    if (this.snakeCount[s]) { const t = this.body[this.body.length - 1]; if (t.x !== x0 || t.y !== y0) return -1; }
    const seen = this.seen, q = this.bfsQ, limit = this.body.length * 2 + 12;
    seen.fill(0);
    let qh = 0, qt = 0;
    seen[s] = 1; q[qt++] = s;
    while (qh < qt && qt < limit) {
      const c = q[qh++], cx = c % cols, cy = (c / cols) | 0;
      for (let k = 0; k < 4; k++) {
        const x = (cx + DX[k] + cols) % cols, y = (cy + DY[k] + rows) % rows, i = y * cols + x;
        if (seen[i] || this.blocked[i] || this.snakeCount[i]) continue;
        seen[i] = 1; q[qt++] = i;
      }
    }
    return qt;
  }
}
