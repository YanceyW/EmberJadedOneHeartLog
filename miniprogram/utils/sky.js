/**
 * 天空时段和粒子。
 * 太阳、云、风、雨、雪、雾、雷都画在同一块铺满天气卡片的画布上，字浮在画布上面。
 * 会下落的受重力，并被空气拖向自己的落速。云和雾只跟风走。
 * 积雪是边框上一整层厚度，不画成圆点或矩形。
 */

function between(min, max) {
  return min + Math.random() * (max - min);
}

function clockMinutes(text) {
  const matched = String(text || "").match(/(\d{1,2}):(\d{2})/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function dayMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 算出当前时段，以及太阳在屏幕上的比例位置。
 * 有日出日落时按当地时间；没有时按本机钟点估算。
 * @param {Date} now
 * @param {string} sunrise 例如 06:32
 * @param {string} sunset 例如 17:45
 * @returns {{phase: string, sunX: number, sunY: number, showSun: boolean}}
 */
function skyMoment(now, sunrise, sunset) {
  const minute = dayMinutes(now);
  const rise = clockMinutes(sunrise);
  const set = clockMinutes(sunset);
  const useSun = rise !== null && set !== null && set > rise + 90;
  let phase = "day";
  if (!useSun) {
    if (minute < 300 || minute >= 1200) phase = "night";
    else if (minute < 420) phase = "dawn";
    else if (minute >= 1020) phase = "dusk";
  } else if (minute < rise - 40 || minute >= set + 40) {
    phase = "night";
  } else if (minute < rise + 50) {
    phase = "dawn";
  } else if (minute >= set - 50) {
    phase = "dusk";
  }

  let progress = 0.5;
  if (useSun) {
    progress = (minute - rise) / (set - rise);
  } else if (phase === "dawn") {
    progress = 0.04;
  } else if (phase === "dusk") {
    progress = 0.96;
  } else if (phase === "night") {
    progress = minute < 300 ? 0 : 1;
  } else {
    progress = (minute - 420) / 600;
  }
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;
  const lift = Math.sin(Math.PI * progress);
  const sunX = (10 + progress * 74) / 100;
  const sunY = (34 - lift * 26) / 100;
  const placed = screenPlace(sunX, sunY);
  return {
    phase,
    sunX,
    sunY,
    sunLeft: placed.left,
    sunTop: placed.top,
    showSun: phase !== "night",
  };
}

/** 把 0 到 1 的位置写成小程序里真正会铺开的单位。 */
function screenPlace(x, y) {
  return {
    left: `${Math.round(x * 750)}rpx`,
    top: `${Math.round(y * 100)}vh`,
  };
}

/**
 * 月出月落之间的位置。没有时间时放在偏右的夜空，避免缩在左上角。
 * @returns {{left: string, top: string, x: number, y: number}}
 */
function moonMoment(now, moonrise, moonset) {
  const minute = dayMinutes(now);
  const rise = clockMinutes(moonrise);
  const set = clockMinutes(moonset);
  let progress = 0.62;
  if (rise !== null && set !== null && rise !== set) {
    let span = set - rise;
    let along = minute - rise;
    if (span < 0) span += 1440;
    if (along < 0) along += 1440;
    if (along > span) along = span;
    progress = along / span;
  }
  const lift = Math.sin(Math.PI * progress);
  const x = 0.16 + progress * 0.66;
  const y = (32 - lift * 18) / 100;
  const placed = screenPlace(x, y);
  return { left: placed.left, top: placed.top, x, y };
}

/** 和风月相名。缺省时按日期在八相里轮换。 */
function moonPhaseKey(name, date) {
  const text = String(name || "");
  if (text.indexOf("新月") >= 0) return "new";
  if (text.indexOf("峨眉") >= 0 || text.indexOf("蛾眉") >= 0) return "wax-crescent";
  if (text.indexOf("上弦") >= 0) return "first";
  if (text.indexOf("盈凸") >= 0) return "wax-gibbous";
  if (text.indexOf("满月") >= 0) return "full";
  if (text.indexOf("亏凸") >= 0) return "wan-gibbous";
  if (text.indexOf("下弦") >= 0) return "last";
  if (text.indexOf("残月") >= 0) return "wan-crescent";
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date - start) / 86400000);
  const keys = ["new", "wax-crescent", "first", "wax-gibbous", "full", "wan-gibbous", "last", "wan-crescent"];
  return keys[Math.floor(((day % 30) / 30) * 8) % 8];
}

function needsCanvas(kind) {
  return kind === "sun" || kind === "cloud" || kind === "fog" || kind === "rain" || kind === "snow" || kind === "storm";
}

/** 只要开着天气，就要量出卡片，才能把字从画布上让出来。 */
function needsHit(kind) {
  return needsCanvas(kind);
}

const CLOUD_BANDS = [0.08, 0.22, 0.38, 0.54, 0.7, 0.86];
const SNOW_MAX = 20;
const MOON_SHIFT = {
  new: 1.15,
  "wax-crescent": 0.72,
  first: 0.42,
  "wax-gibbous": 0.2,
  full: 0,
  "wan-gibbous": -0.2,
  last: -0.42,
  "wan-crescent": -0.72,
};

/**
 * 重力往下拉，空气阻力把速度拖向落速，风从侧面推。
 * @param {{x:number,y:number,vx:number,vy:number,gravity:number,drag:number,windage:number}} body
 * @param {number} dt
 * @param {number} wind 横向风力，1 左右是一阵普通的风
 */
function pushBody(body, dt, wind) {
  body.px = body.x;
  body.py = body.y;
  body.vy += body.gravity * dt;
  const damp = Math.exp(-body.drag * dt);
  body.vy *= damp;
  const aim = wind * body.windage * (body.gravity < 0 ? 40 : Math.abs(body.gravity) / body.drag);
  body.vx += (aim - body.vx) * (1 - damp);
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}

/** 风的强弱。横滑会短时间把 gustBoost 顶起来。 */
function windPush(cast) {
  const gust = cast.gustDir * Math.min(1.4, cast.gustBoost / 320);
  const puff = Math.sin(cast.time * 0.65) * (cast.windy ? 0.28 : 0.08);
  return (cast.windy ? 1 : 0.22) + gust + puff;
}

function makeDrop(width, height, fierce) {
  const near = Math.random() > 0.55;
  const gravity = fierce ? 2400 : 1800;
  const drag = near ? 1.7 : 3.6;
  return {
    x: between(-40, width + 40),
    y: between(-height, height),
    px: 0,
    py: 0,
    vx: between(-30, 30),
    vy: (gravity / drag) * between(0.7, 0.95),
    len: near ? between(22, 42) : between(10, 18),
    alpha: near ? between(0.55, 0.95) : between(0.2, 0.45),
    thick: near ? between(1.3, 2.1) : between(0.6, 1.05),
    gravity,
    drag,
    windage: near ? 0.42 : 0.85,
  };
}

function makeFlake(width, height) {
  const gravity = between(340, 560);
  const drag = between(3.6, 5.2);
  return {
    x: between(0, width),
    y: between(-height, height),
    px: 0,
    py: 0,
    vx: between(-12, 12),
    vy: (gravity / drag) * between(0.55, 0.9),
    r: between(1, 2.6),
    gravity,
    drag,
    windage: between(1.05, 1.45),
    sway: between(16, 42),
    phase: between(0, Math.PI * 2),
    alpha: between(0.55, 0.96),
  };
}

function makeGust(width, height) {
  return {
    x: between(-width, width),
    y: between(height * 0.04, height * 0.96),
    len: between(width * 0.18, width * 0.42),
    speed: between(160, 420),
    alpha: between(0.35, 0.75),
    thick: between(1.4, 2.6),
    lift: between(-10, 12),
    phase: between(0, Math.PI * 2),
  };
}

function makeLeaf(width, height, color) {
  return {
    x: between(-40, width),
    y: between(height * 0.05, height * 0.92),
    px: 0,
    py: 0,
    vx: between(40, 140),
    vy: between(-10, 30),
    gravity: 240,
    drag: 0.85,
    windage: 1.35,
    size: between(5, 9),
    spin: between(0, Math.PI * 2),
    turn: between(1.4, 3.4),
    color,
  };
}

function makeCloud(width, height, band, windy) {
  const scale = between(0.48, 0.82);
  return {
    x: between(-width * 0.2, width * 0.95),
    y: height * band,
    scale,
    speed: between(windy ? 16 : 8, windy ? 34 : 16) / scale,
  };
}

function makeMote(width, height) {
  const gravity = -between(14, 32);
  return {
    x: between(0, width),
    y: between(0, height),
    px: 0,
    py: 0,
    vx: between(-8, 8),
    vy: gravity * 0.6,
    r: between(1.4, 3.4),
    gravity,
    drag: 1.1,
    windage: 0.7,
    alpha: between(0.08, 0.22),
  };
}

function makeStar(width, height) {
  return {
    x: between(width * 0.02, width * 0.98),
    y: between(height * 0.02, height * 0.88),
    r: Math.random() > 0.82 ? 1.7 : 1.05,
    phase: between(0, Math.PI * 2),
    alpha: between(0.4, 1),
  };
}

/**
 * 建一套粒子。之后每帧只改速度和坐标。
 * @param {{kind: string, windy: boolean, heavy: boolean, width: number, height: number}} spec
 */
function createCast(spec) {
  const width = spec.width || 1;
  const height = spec.height || 1;
  const kind = spec.kind;
  const windy = !!spec.windy;
  const fierce = !!spec.heavy || kind === "storm";
  const cast = {
    kind,
    windy,
    heavy: !!spec.heavy,
    width,
    height,
    drops: [],
    flakes: [],
    gusts: [],
    leaves: [],
    clouds: [],
    motes: [],
    stars: [],
    splashes: [],
    shelves: {},
    shelfEdges: [],
    veils: [],
    holes: [],
    sprite: null,
    bolt: null,
    flash: 0,
    nextBolt: between(5, 9),
    gustBoost: 0,
    gustDir: 1,
    gustLeft: 0,
    time: 0,
  };
  const dropCount = kind === "storm" || fierce && kind === "rain" ? 96 : kind === "rain" ? 64 : 0;
  const flakeCount = kind === "snow" ? 72 : 0;
  for (let index = 0; index < dropCount; index += 1) cast.drops.push(makeDrop(width, height, fierce));
  for (let index = 0; index < flakeCount; index += 1) cast.flakes.push(makeFlake(width, height));
  if (kind === "cloud") {
    for (let index = 0; index < CLOUD_BANDS.length; index += 1) {
      cast.clouds.push(makeCloud(width, height, CLOUD_BANDS[index], windy));
    }
  }
  if (kind === "sun") {
    for (let index = 0; index < 18; index += 1) cast.motes.push(makeMote(width, height));
  }
  if (kind === "sun") {
    for (let index = 0; index < 36; index += 1) cast.stars.push(makeStar(width, height));
  } else if (kind === "cloud") {
    for (let index = 0; index < 14; index += 1) cast.stars.push(makeStar(width, height));
  }
  if (windy) {
    const colors = ["#8a9a62", "#c4a24a", "#6d8c4a", "#a6844a"];
    for (let index = 0; index < 14; index += 1) cast.gusts.push(makeGust(width, height));
    for (let index = 0; index < 8; index += 1) cast.leaves.push(makeLeaf(width, height, colors[index % colors.length]));
  }
  if (kind === "fog") {
    cast.veils = [
      { y: 0.12, h: 0.4, alpha: 0.2, drift: 10, x: 0 },
      { y: 0.38, h: 0.46, alpha: 0.32, drift: 18, x: 30 },
      { y: 0.66, h: 0.4, alpha: 0.16, drift: 8, x: -20 },
    ];
  }
  return cast;
}

function wrapX(value, width) {
  if (value < -40) return width + 16;
  if (value > width + 40) return -16;
  return value;
}

/**
 * 卡片自己的边框。下边框接雨滴的水花，也堆雪；雪天再给上边框留一条薄雪。
 * 画布本身被卡片的圆角裁掉，所以两条边都铺到两头。
 * 上边框那条雪沿是装饰，不拦雪花，雪才落得到下边框。
 * @param {number} width
 * @param {number} height
 * @param {string} kind
 */
function frameEdges(width, height, kind) {
  const edges = [{
    left: 2,
    top: height - 2,
    width: Math.max(12, width - 4),
    height: 18,
    shelf: true,
    radius: 0,
  }];
  if (kind === "snow") {
    edges.push({
      left: 2,
      top: 8,
      width: Math.max(12, width - 4),
      height: 18,
      shelf: true,
      decor: true,
      base: 7,
      radius: 0,
    });
  }
  return edges;
}

function edgeKey(edge) {
  return `${Math.round(edge.left)}:${Math.round(edge.top / 12)}`;
}

/** 顶边的高度。圆角两端顺着圆弧下降，圆钮上沿用上弧。 */
function groundY(edge, x) {
  const top = edge.top;
  const radius = Math.max(0, Math.min(edge.radius || 0, (edge.height || 0) / 2, edge.width / 2));
  let y = top;
  if (radius > 0) {
    const left = edge.left;
    const right = edge.left + edge.width;
    if (x < left + radius) {
      const dx = x - (left + radius);
      y = top + radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
    } else if (x > right - radius) {
      const dx = x - (right - radius);
      y = top + radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
    }
  }
  const circle = edge.circle;
  if (!circle) return y;
  const dx = x - circle.cx;
  if (Math.abs(dx) >= circle.r) return y;
  const arc = circle.cy - Math.sqrt(Math.max(0, circle.r * circle.r - dx * dx));
  if (arc < y) y = arc;
  return y;
}

/** 越靠近圆角，雪越薄，避免在圆角外面伸出一条直边。 */
function snowDepth(edge, x, depth) {
  const radius = Math.max(0, edge.radius || 0);
  if (radius <= 0) return depth;
  const into = Math.min(x - edge.left, edge.left + edge.width - x);
  if (into >= radius) return depth;
  return depth * Math.max(0, into / radius);
}

/** 圆钮只有靠近顶部的弧面留得住雪，肩部会滑下去。 */
function slopeHolds(edge, x) {
  const circle = edge.circle;
  if (!circle) return true;
  const dx = x - circle.cx;
  if (Math.abs(dx) >= circle.r) return true;
  return Math.abs(dx) <= circle.r * 0.62;
}

function carryShelves(cast, edges) {
  const previous = cast.shelfEdges || [];
  const next = {};
  const kept = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.shelf === false || !edge.width) continue;
    let best = null;
    let bestDist = 180;
    for (let oldIndex = 0; oldIndex < previous.length; oldIndex += 1) {
      const old = previous[oldIndex];
      if (Math.abs(old.left - edge.left) > 36) continue;
      if (Math.abs((old.width || 0) - edge.width) > 36) continue;
      const dist = Math.abs(old.top - edge.top);
      if (dist < bestDist) {
        bestDist = dist;
        best = old;
      }
    }
    const key = edgeKey(edge);
    const carried = best ? cast.shelves[edgeKey(best)] : cast.shelves[key];
    if (carried) next[key] = carried;
    kept.push(edge);
  }
  cast.shelves = next;
  cast.shelfEdges = kept;
}

function shelfRow(cast, edge) {
  const key = edgeKey(edge);
  const count = Math.max(12, Math.min(160, Math.ceil(edge.width / 3)));
  let row = cast.shelves[key];
  if (!row || Math.abs(row.length - count) > 2) {
    const next = [];
    for (let index = 0; index < count; index += 1) {
      let value = edge.base || 1.1;
      if (row && row.length) {
        const from = Math.min(row.length - 1, Math.floor((index * row.length) / count));
        value = row[from];
      }
      next.push(value);
    }
    row = next;
    cast.shelves[key] = row;
  }
  return row;
}

function depositSnow(row, edge, x, amount) {
  const last = row.length - 1;
  const index = Math.round(((x - edge.left) / edge.width) * last);
  for (let offset = -2; offset <= 2; offset += 1) {
    const at = index + offset;
    if (at < 0 || at > last) continue;
    const weight = offset === 0 ? 1 : Math.abs(offset) === 1 ? 0.45 : 0.18;
    row[at] = Math.min(SNOW_MAX, row[at] + amount * weight);
  }
}

/** 高的雪往低处塌，风再把厚度慢慢推向下风一侧。 */
function settleSnow(row, wind) {
  const next = row.slice();
  const dir = wind > 0.4 ? 1 : wind < -0.4 ? -1 : 0;
  for (let index = 0; index < row.length; index += 1) {
    const left = row[Math.max(0, index - 1)];
    const right = row[Math.min(row.length - 1, index + 1)];
    let value = row[index] + (left + right - 2 * row[index]) * 0.14;
    if (dir !== 0) {
      const from = index - dir;
      if (from >= 0 && from < row.length) value += (row[from] - row[index]) * 0.05 * Math.min(1, Math.abs(wind));
    }
    if (value > SNOW_MAX) {
      const extra = (value - SNOW_MAX) * 0.5;
      value = SNOW_MAX;
      if (index > 0) next[index - 1] += extra * 0.5;
      if (index < row.length - 1) next[index + 1] += extra * 0.5;
    }
    next[index] = Math.max(0, value);
  }
  for (let index = 0; index < row.length; index += 1) row[index] = next[index];
}

function firstShelf(body, edges) {
  let found = null;
  let surface = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.shelf === false || edge.decor || !edge.width) continue;
    if (body.x < edge.left || body.x > edge.left + edge.width) continue;
    const y = groundY(edge, body.x);
    if (body.py < y + 1 && body.y >= y && body.vy > 0) {
      if (!found || y < surface) {
        found = edge;
        surface = y;
      }
    }
  }
  return found;
}

function burst(cast, x, y, vx) {
  for (let index = 0; index < 3; index += 1) {
    let slot = null;
    for (let splashIndex = 0; splashIndex < cast.splashes.length; splashIndex += 1) {
      if (cast.splashes[splashIndex].life <= 0) {
        slot = cast.splashes[splashIndex];
        break;
      }
    }
    if (!slot) {
      if (cast.splashes.length >= 28) return;
      slot = { x: 0, y: 0, vx: 0, vy: 0, life: 0 };
      cast.splashes.push(slot);
    }
    slot.x = x + between(-3, 3);
    slot.y = y;
    slot.vx = vx * 0.15 + between(-90, 90);
    slot.vy = between(-220, -70);
    slot.life = 0.32;
  }
}

function stepSplashes(cast, dt) {
  for (let index = 0; index < cast.splashes.length; index += 1) {
    const splash = cast.splashes[index];
    if (splash.life <= 0) continue;
    splash.vy += 980 * dt;
    splash.x += splash.vx * dt;
    splash.y += splash.vy * dt;
    splash.life -= dt;
  }
}

function respawnFlake(flake, width) {
  flake.x = between(0, width);
  flake.y = between(-50, -8);
  flake.px = flake.x;
  flake.py = flake.y;
  flake.vy = (flake.gravity / flake.drag) * 0.7;
  flake.vx = between(-10, 10);
}

function stepCast(cast, dt, edges) {
  const step = dt > 0 ? dt : 0;
  const covers = edges || [];
  cast.time += step;
  if (cast.gustLeft > 0) {
    cast.gustLeft -= step;
    if (cast.gustLeft <= 0) {
      cast.gustLeft = 0;
      cast.gustBoost = 0;
    }
  }
  const wind = windPush(cast);
  const width = cast.width;
  const height = cast.height;
  carryShelves(cast, covers);
  const shelves = cast.shelfEdges;
  for (let index = 0; index < shelves.length; index += 1) {
    const row = shelfRow(cast, shelves[index]);
    if (cast.kind === "snow") settleSnow(row, wind * cast.gustDir);
  }
  for (let index = 0; index < cast.drops.length; index += 1) {
    const drop = cast.drops[index];
    pushBody(drop, step, wind);
    const shelf = firstShelf(drop, shelves);
    if (shelf && slopeHolds(shelf, drop.x)) burst(cast, drop.x, groundY(shelf, drop.x), drop.vx);
    if (drop.y > height + 30) {
      drop.y = between(-80, -8);
      drop.x = between(-40, width + 40);
      drop.py = drop.y;
      drop.vy = (drop.gravity / drop.drag) * 0.75;
    }
    drop.x = wrapX(drop.x, width);
  }
  for (let index = 0; index < cast.flakes.length; index += 1) {
    const flake = cast.flakes[index];
    const sway = Math.sin(cast.time * 0.8 + flake.phase) * flake.sway;
    pushBody(flake, step, wind + sway / 80);
    const shelf = firstShelf(flake, shelves);
    if (shelf && slopeHolds(shelf, flake.x)) {
      depositSnow(shelfRow(cast, shelf), shelf, flake.x, 1.6);
      respawnFlake(flake, width);
    } else if (flake.y > height + 12) {
      respawnFlake(flake, width);
    } else {
      flake.x = wrapX(flake.x, width);
    }
  }
  const push = wind * 140;
  for (let index = 0; index < cast.gusts.length; index += 1) {
    const gust = cast.gusts[index];
    const burstScale = 0.55 + 0.45 * Math.sin(cast.time * 1.4 + gust.phase);
    gust.x += (gust.speed * burstScale + push) * step * cast.gustDir;
    if (cast.gustDir >= 0 && gust.x > width + 20) {
      gust.x = -gust.len;
      gust.y = between(height * 0.04, height * 0.96);
    } else if (cast.gustDir < 0 && gust.x + gust.len < -20) {
      gust.x = width + 8;
      gust.y = between(height * 0.04, height * 0.96);
    }
  }
  for (let index = 0; index < cast.leaves.length; index += 1) {
    const leaf = cast.leaves[index];
    pushBody(leaf, step, wind);
    leaf.spin += leaf.turn * step * cast.gustDir;
    if (leaf.x > width + 24 || leaf.x < -24 || leaf.y > height + 16) {
      leaf.x = cast.gustDir < 0 ? width + 10 : -16;
      leaf.y = between(height * 0.04, height * 0.7);
      leaf.vy = between(-20, 20);
    }
  }
  for (let index = 0; index < cast.clouds.length; index += 1) {
    const cloud = cast.clouds[index];
    cloud.x += (cloud.speed + push * 0.12) * step * (cast.gustDir < 0 ? -1 : 1);
    const limit = width + 80 * cloud.scale;
    if (cloud.x > limit) cloud.x = -90 * cloud.scale;
    if (cloud.x < -limit) cloud.x = width + 40;
  }
  for (let index = 0; index < cast.motes.length; index += 1) {
    const mote = cast.motes[index];
    pushBody(mote, step, wind * 0.4);
    if (mote.y < -8) {
      mote.y = height + 6;
      mote.x = between(0, width);
      mote.vy = mote.gravity * 0.5;
    }
    mote.x = wrapX(mote.x, width);
  }
  for (let index = 0; index < cast.veils.length; index += 1) {
    cast.veils[index].x += cast.veils[index].drift * wind * cast.gustDir * step;
  }
  for (let index = cast.holes.length - 1; index >= 0; index -= 1) {
    const hole = cast.holes[index];
    hole.x += wind * 16 * cast.gustDir * step;
    hole.r += 10 * step;
    hole.alpha -= 0.12 * step;
    if (hole.alpha <= 0.04) cast.holes.splice(index, 1);
  }
  stepSplashes(cast, step);
  if (cast.kind === "storm") {
    cast.nextBolt -= step;
    if (cast.nextBolt <= 0) {
      cast.bolt = makeBolt(width, height);
      cast.flash = 0.7;
      cast.nextBolt = between(6.5, 12);
    }
  }
  if (cast.bolt) {
    cast.bolt.life -= step;
    if (cast.bolt.life <= 0) cast.bolt = null;
  }
  if (cast.flash > 0) cast.flash = Math.max(0, cast.flash - step * 3.2);
}

function makeBolt(width, height) {
  let x = between(width * 0.18, width * 0.82);
  const segments = [{ x, y: 0 }];
  let y = 0;
  const end = height * between(0.38, 0.72);
  while (y < end && segments.length < 14) {
    y += between(28, 58);
    x += between(-36, 36);
    segments.push({ x, y: y > end ? end : y });
    if (segments.length === 5) {
      segments.fork = [
        { x, y },
        { x: x + between(-50, 50), y: y + between(30, 70) },
        { x: x + between(-30, 70), y: y + between(70, 120) },
      ];
    }
  }
  return { segments, life: 0.18 };
}

function strikeCast(cast) {
  cast.flash = 0.7;
  cast.bolt = makeBolt(cast.width, cast.height);
}

/** 横滑、快滚时风短时间跟着加快。 */
function nudgeCast(cast, x, y, dx) {
  if (!cast || Math.abs(dx) < 4) return;
  const push = Math.min(1, Math.abs(dx) / 60);
  cast.gustDir = dx < 0 ? -1 : 1;
  cast.gustBoost = Math.max(cast.gustBoost || 0, 300 + push * 520);
  cast.gustLeft = Math.max(cast.gustLeft || 0, 0.7 + push * 0.7);
}

/** 手指抹开顶边上的一层雪。旁边较高的雪会再塌进来。 */
function brushSnow(cast, x, y) {
  const edges = cast.shelfEdges || [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (x < edge.left || x > edge.left + edge.width) continue;
    const surface = groundY(edge, x);
    if (y < surface - 30 || y > surface + 18) continue;
    const row = cast.shelves[edgeKey(edge)];
    if (!row) continue;
    const at = Math.round(((x - edge.left) / edge.width) * (row.length - 1));
    for (let offset = -3; offset <= 3; offset += 1) {
      const slot = at + offset;
      if (slot < 0 || slot >= row.length) continue;
      const fall = offset === 0 ? 7 : 4 / (Math.abs(offset) + 0.35);
      row[slot] = Math.max(0, row[slot] - fall);
    }
  }
}

/** 在雾里擦开一个洞，洞会跟着风飘并慢慢合上。 */
function pokeFog(cast, x, y) {
  if (!cast) return;
  cast.holes.push({ x, y, r: 72, alpha: 1 });
  if (cast.holes.length > 24) cast.holes.shift();
}

function punchRound(ctx, x, y, width, height, radius) {
  const limit = Math.min(width / 2, height / 2);
  const r = Math.max(0, Math.min(radius, limit));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

function coverRadius(edge) {
  if (edge.pill) return Math.min(edge.width, edge.height) / 2;
  if (edge.radius) return Math.min(edge.radius, edge.width / 2, edge.height / 2);
  if (edge.height < 42) return Math.min(edge.width, edge.height) / 2;
  return 16;
}

/** 把卡片、标题、气泡和底栏从画布上擦掉，字才能透出来。 */
function punchCovers(ctx, edges) {
  if (!edges || !edges.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000000";
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.width && edge.height) {
      punchRound(ctx, edge.left, edge.top, edge.width, edge.height, coverRadius(edge));
    }
    if (edge.circle) {
      ctx.beginPath();
      ctx.arc(edge.circle.cx, edge.circle.cy, edge.circle.r + 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function fillDisc(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** 软边雪花画一次，之后每片只贴这张图。没有离屏画布时退回小圆。 */
function makeFlakeSprite() {
  if (typeof wx === "undefined" || !wx.createOffscreenCanvas) return null;
  try {
    const off = wx.createOffscreenCanvas({ type: "2d", width: 32, height: 32 });
    const ctx = off.getContext("2d");
    const glow = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.45, "rgba(244,248,252,0.5)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
    return off;
  } catch (error) {
    return null;
  }
}

/**
 * 太阳：没有硬边。从外到内是整卡暖光、柔光晕、缓慢转的光芒、球体本身。
 */
function paintDaySun(ctx, cast, phase, focus) {
  const width = cast.width;
  const height = cast.height;
  const cx = focus.x * width;
  const cy = focus.y * height;
  const high = Math.max(0.25, 1 - focus.y * 2.2);
  const radius = Math.max(16, Math.min(width, height) * 0.07) * (0.88 + high * 0.22);
  const time = cast.time || 0;

  const reach = Math.min(width, height) * 0.98;
  const wash = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, reach);
  if (phase === "dusk") {
    wash.addColorStop(0, "rgba(255, 178, 112, 0.3)");
    wash.addColorStop(0.45, "rgba(240, 132, 96, 0.12)");
    wash.addColorStop(1, "rgba(232, 108, 88, 0)");
  } else if (phase === "dawn") {
    wash.addColorStop(0, "rgba(255, 208, 168, 0.28)");
    wash.addColorStop(0.45, "rgba(248, 176, 150, 0.11)");
    wash.addColorStop(1, "rgba(244, 160, 140, 0)");
  } else {
    wash.addColorStop(0, "rgba(255, 224, 150, 0.26)");
    wash.addColorStop(0.45, "rgba(255, 205, 130, 0.1)");
    wash.addColorStop(1, "rgba(255, 198, 140, 0)");
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < cast.motes.length; index += 1) {
    const mote = cast.motes[index];
    fillDisc(ctx, mote.x, mote.y, mote.r, `rgba(255, 236, 190, ${mote.alpha})`);
  }

  const bloom = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 4.2);
  bloom.addColorStop(0, "rgba(255, 228, 158, 0.42)");
  bloom.addColorStop(0.4, "rgba(255, 208, 132, 0.14)");
  bloom.addColorStop(1, "rgba(255, 198, 128, 0)");
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 4.2, 0, Math.PI * 2);
  ctx.fill();

  const rays = 16;
  const turn = time * 0.07;
  ctx.save();
  ctx.lineCap = "round";
  for (let index = 0; index < rays; index += 1) {
    const angle = turn + (index * Math.PI * 2) / rays;
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.1 + index * 1.7);
    const inner = radius * 1.12;
    const outer = radius * (1.32 + pulse * 0.34);
    ctx.strokeStyle = `rgba(255, 240, 196, ${0.1 + pulse * 0.16})`;
    ctx.lineWidth = Math.max(1.2, radius * 0.055);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();

  const halo = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius * 1.9);
  halo.addColorStop(0, "rgba(255, 248, 222, 0.5)");
  halo.addColorStop(1, "rgba(255, 234, 180, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.34,
    radius * 0.12,
    cx,
    cy,
    radius
  );
  core.addColorStop(0, "#fffdf4");
  core.addColorStop(0.45, "#ffefb9");
  core.addColorStop(0.82, phase === "dusk" ? "#ffcf78" : "#ffd56d");
  core.addColorStop(1, phase === "dusk" ? "#f2a24e" : "#f6b745");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function paintMoon(ctx, x, y, phaseKey, shade) {
  const radius = 16;
  const shift = MOON_SHIFT[phaseKey] === undefined ? 0 : MOON_SHIFT[phaseKey];
  // 暗面 = 夜光之后的天色再加月亮自己那层光晕，几乎和周围一样，只留亮面
  const dark = rgbCss(mixRgb(shade || [32, 44, 64], [228, 236, 252], 0.3));

  const glow = ctx.createRadialGradient(x, y, radius * 0.6, x, y, radius * 3.8);
  glow.addColorStop(0, "rgba(228, 236, 252, 0.3)");
  glow.addColorStop(1, "rgba(214, 228, 250, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const body = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.4,
    radius * 0.1,
    x,
    y,
    radius
  );
  body.addColorStop(0, "#fdfbf2");
  body.addColorStop(0.75, "#f1eddd");
  body.addColorStop(1, "#dcd7c5");
  ctx.fillStyle = body;
  ctx.fillRect(x - radius - 2, y - radius - 2, radius * 2 + 4, radius * 2 + 4);
  if (Math.abs(shift) >= 1) {
    ctx.fillStyle = dark;
    ctx.fillRect(x - radius - 2, y - radius - 2, radius * 2 + 4, radius * 2 + 4);
  } else if (shift) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(x - shift * radius * 1.2, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintNightSky(ctx, cast, focus, phaseKey) {
  const width = cast.width;
  const height = cast.height;
  const mx = (focus.x || 0.72) * width;
  const my = (focus.y || 0.16) * height;
  const glowRgb = [214, 224, 246];
  const glow = ctx.createRadialGradient(mx, my, 10, mx, my, Math.max(width, height) * 0.7);
  const bright = phaseKey === "full" ? 0.46 : phaseKey === "new" ? 0.08 : 0.28;
  glow.addColorStop(0, `rgba(214, 224, 246, ${bright})`);
  glow.addColorStop(1, "rgba(214, 224, 246, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < cast.stars.length; index += 1) {
    const star = cast.stars[index];
    const twinkle = 0.45 + 0.55 * Math.sin(cast.time * 1.4 + star.phase);
    fillDisc(ctx, star.x, star.y, star.r, `rgba(255, 255, 255, ${star.alpha * twinkle})`);
  }
  // 月亮暗面用"这层夜光之后"的底色，才不会看起来像一块黑饼
  const shade = mixRgb(skyColorAt(cast.kind, "night", focus.y || 0.16), glowRgb, bright);
  paintMoon(ctx, mx, my, phaseKey || "full", shade);
}

function paintCloud(ctx, cloud, phase) {
  const radius = 26 * cloud.scale;
  let color = "rgba(255, 255, 255, 0.9)";
  if (phase === "night") color = "rgba(30, 42, 62, 0.82)";
  else if (phase === "dusk") color = "rgba(255, 214, 196, 0.84)";
  else if (phase === "dawn") color = "rgba(255, 228, 214, 0.86)";
  ctx.fillStyle = color;
  const blobs = [
    [0, 0, radius],
    [-radius * 0.78, radius * 0.2, radius * 0.68],
    [radius * 0.8, radius * 0.14, radius * 0.72],
  ];
  for (let index = 0; index < blobs.length; index += 1) {
    const blob = blobs[index];
    fillDisc(ctx, cloud.x + blob[0], cloud.y + blob[1], blob[2], color);
  }
}

function paintFog(ctx, cast, phase) {
  const width = cast.width;
  const height = cast.height;
  ctx.save();
  for (let index = 0; index < cast.veils.length; index += 1) {
    const veil = cast.veils[index];
    const tone = phase === "night" ? "126, 138, 154" : phase === "dawn" ? "238, 232, 226" : "236, 240, 243";
    const y = veil.y * height;
    const h = veil.h * height;
    const fade = ctx.createLinearGradient(0, y, 0, y + h);
    fade.addColorStop(0, `rgba(${tone}, 0)`);
    fade.addColorStop(0.45, `rgba(${tone}, ${Math.min(0.62, veil.alpha * 1.7)})`);
    fade.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = fade;
    ctx.fillRect(veil.x - width, y, width * 3, h);
  }
  ctx.globalCompositeOperation = "destination-out";
  for (let index = 0; index < cast.holes.length; index += 1) {
    const hole = cast.holes[index];
    const wipe = ctx.createRadialGradient(hole.x, hole.y, hole.r * 0.15, hole.x, hole.y, hole.r);
    wipe.addColorStop(0, `rgba(0,0,0,${hole.alpha})`);
    wipe.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wipe;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintBlanket(ctx, edge, row, viewHeight) {
  if (edge.top < -4 || edge.top > viewHeight + 8) return;
  let peak = 0;
  for (let index = 0; index < row.length; index += 1) if (row[index] > peak) peak = row[index];
  if (peak < 0.6) return;
  const last = row.length - 1;
  ctx.beginPath();
  for (let index = 0; index <= last; index += 1) {
    const x = edge.left + (edge.width * index) / last;
    const y = groundY(edge, x) - snowDepth(edge, x, row[index]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let index = last; index >= 0; index -= 1) {
    const x = edge.left + (edge.width * index) / last;
    ctx.lineTo(x, groundY(edge, x) + 2);
  }
  ctx.closePath();
  const crest = groundY(edge, edge.left + edge.width / 2) - peak;
  const foot = edge.top + 4;
  const fill = ctx.createLinearGradient(0, crest, 0, foot);
  fill.addColorStop(0, "rgba(255,255,255,0.98)");
  fill.addColorStop(0.55, "rgba(238,246,254,0.94)");
  fill.addColorStop(1, "rgba(212,228,244,0.62)");
  ctx.fillStyle = fill;
  ctx.fill();
}

function paintSplashes(ctx, cast) {
  for (let index = 0; index < cast.splashes.length; index += 1) {
    const splash = cast.splashes[index];
    if (splash.life <= 0) continue;
    const alpha = Math.max(0, splash.life / 0.32);
    ctx.strokeStyle = `rgba(244,250,255,${0.9 * alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(splash.x, splash.y);
    ctx.lineTo(splash.x - splash.vx * 0.04, splash.y - Math.max(6, -splash.vy * 0.04));
    ctx.stroke();
    fillDisc(ctx, splash.x, splash.y, 0.6 + alpha * 2.2, `rgba(255,255,255,${0.85 * alpha})`);
  }
}

function traceBolt(ctx, points) {
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
}

/**
 * 卡片铺满天空以后，底色要压得住白字：上深下亮，最亮的一点留给地平线。
 * @returns {string[]} 上、中、下三段颜色
 */
function skyColors(kind, phase) {
  const night = phase === "night";
  const dawn = phase === "dawn";
  const dusk = phase === "dusk";
  if (kind === "sun") {
    if (night) return ["#101a30", "#25334f", "#46536b"];
    if (dawn) return ["#4a5f92", "#c98f94", "#f3c8a8"];
    if (dusk) return ["#3d3f70", "#b96a68", "#f0a878"];
    return ["#2e6fae", "#6ba3d6", "#f0d9b5"];
  }
  if (kind === "cloud") {
    if (night) return ["#141d2c", "#2a3549", "#465063"];
    if (dawn) return ["#6d6076", "#b79a9c", "#dcc3b4"];
    if (dusk) return ["#5a4a63", "#a97b7c", "#cfa493"];
    return ["#4a6b8f", "#8ba7bd", "#d9d7cd"];
  }
  if (kind === "snow") {
    if (night) return ["#19253a", "#31425c", "#556a84"];
    return ["#4f7aa8", "#93b3cd", "#e8eef4"];
  }
  if (kind === "fog") {
    if (night) return ["#232a34", "#454d58", "#6a717a"];
    return ["#6d7c8a", "#9aa7b2", "#cfd6da"];
  }
  if (kind === "storm") return night ? ["#0b101a", "#18202e", "#2a3646"] : ["#222c3c", "#3d4c60", "#5b6b80"];
  if (night) return ["#0e1521", "#1f2b3b", "#35455a"];
  return ["#3c5265", "#6d8496", "#a7b5bf"];
}

function hexToRgb(hex) {
  const text = String(hex || "").replace("#", "");
  if (text.length < 6) return [128, 128, 128];
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
}

/** 竖直方向某一点上的天空颜色，用来让月亮的暗面融进夜色。 */
function skyColorAt(kind, phase, y) {
  const stops = skyColors(kind, phase);
  const colors = [hexToRgb(stops[0]), hexToRgb(stops[1]), hexToRgb(stops[2])];
  const middle = 0.56;
  const t = Math.max(0, Math.min(1, y || 0));
  const from = t <= middle ? colors[0] : colors[1];
  const to = t <= middle ? colors[1] : colors[2];
  const mix = t <= middle ? t / middle : (t - middle) / (1 - middle);
  return [
    from[0] + (to[0] - from[0]) * mix,
    from[1] + (to[1] - from[1]) * mix,
    from[2] + (to[2] - from[2]) * mix,
  ];
}

function mixRgb(from, to, t) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function rgbCss(color) {
  return `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`;
}

/** 天空够暗时，风纹和字一样用浅色，才看得清。 */
function skyIsDark(kind, phase) {
  const bottom = hexToRgb(skyColors(kind, phase)[2]);
  return (bottom[0] * 0.299 + bottom[1] * 0.587 + bottom[2] * 0.114) / 255 < 0.62;
}

function paintSkyFill(ctx, cast, phase) {
  const colors = skyColors(cast.kind, phase);
  const fill = ctx.createLinearGradient(0, 0, 0, cast.height);
  fill.addColorStop(0, colors[0]);
  fill.addColorStop(0.56, colors[1]);
  fill.addColorStop(1, colors[2]);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, cast.width, cast.height);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} cast
 * @param {string} phase
 * @param {{x:number,y:number}} focus 太阳的比例位置
 * @param {Array} edges
 * @param {{x?:number,y?:number,phase?:string}} moon
 * @param {{punch?: boolean}} [options] 整页画布要把卡片挖开；画在卡片里的画布不用挖
 */
function paintCast(ctx, cast, phase, focus, edges, moon, options) {
  const width = cast.width;
  const height = cast.height;
  const night = phase === "night";
  const point = focus || { x: 0.46, y: 0.16 };
  const moonPoint = moon || { x: 0.72, y: 0.16, phase: "full" };
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "source-over";
  paintSkyFill(ctx, cast, phase);
  if (cast.kind === "sun" && !night) paintDaySun(ctx, cast, phase, point);
  if (night && (cast.kind === "sun" || cast.kind === "cloud")) {
    paintNightSky(ctx, cast, { x: moonPoint.x, y: moonPoint.y }, moonPoint.phase);
  }
  for (let index = 0; index < cast.clouds.length; index += 1) paintCloud(ctx, cast.clouds[index], phase);
  if (cast.kind === "fog") {
    if (!night) {
      const wash = ctx.createLinearGradient(0, 0, 0, height * 0.66);
      wash.addColorStop(0, "rgba(255, 250, 238, 0.38)");
      wash.addColorStop(1, "rgba(255, 250, 238, 0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height * 0.66);
    }
    paintFog(ctx, cast, phase);
  }
  const gustDark = skyIsDark(cast.kind, phase);
  const gustColor = gustDark ? "rgba(238, 244, 253," : "rgba(255, 255, 255,";
  const gustFade = gustDark ? 0.72 : 0.5;
  for (let index = 0; index < cast.gusts.length; index += 1) {
    const gust = cast.gusts[index];
    ctx.strokeStyle = `${gustColor}${(gust.alpha * gustFade).toFixed(3)})`;
    ctx.lineWidth = gust.thick;
    ctx.beginPath();
    ctx.moveTo(gust.x, gust.y);
    ctx.quadraticCurveTo(gust.x + gust.len * 0.5, gust.y + gust.lift, gust.x + gust.len, gust.y + gust.lift * 0.3);
    ctx.stroke();
  }
  for (let index = 0; index < cast.drops.length; index += 1) {
    const drop = cast.drops[index];
    const scale = Math.sqrt(drop.vx * drop.vx + drop.vy * drop.vy) || 1;
    ctx.strokeStyle = `rgba(236, 244, 252, ${drop.alpha})`;
    ctx.lineWidth = drop.thick;
    ctx.beginPath();
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x - (drop.vx / scale) * drop.len, drop.y - (drop.vy / scale) * drop.len);
    ctx.stroke();
  }
  for (let index = 0; index < cast.flakes.length; index += 1) {
    const flake = cast.flakes[index];
    if (cast.sprite) {
      const size = flake.r * 7;
      ctx.globalAlpha = flake.alpha;
      ctx.drawImage(cast.sprite, flake.x - size / 2, flake.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    } else {
      fillDisc(ctx, flake.x, flake.y, flake.r, `rgba(255,255,255,${flake.alpha})`);
    }
  }
  for (let index = 0; index < cast.leaves.length; index += 1) {
    const leaf = cast.leaves[index];
    ctx.save();
    ctx.translate(leaf.x, leaf.y);
    ctx.rotate(leaf.spin);
    ctx.scale(1, 0.55);
    ctx.fillStyle = night ? "rgba(126, 138, 114, 0.9)" : leaf.color;
    ctx.beginPath();
    ctx.arc(0, 0, leaf.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (cast.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${cast.flash * 0.45})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (cast.bolt) {
    traceBolt(ctx, cast.bolt.segments);
    ctx.strokeStyle = "rgba(198, 220, 255, 0.4)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (cast.bolt.segments.fork) {
      traceBolt(ctx, cast.bolt.segments.fork);
      ctx.strokeStyle = "rgba(226, 236, 255, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  if (options && options.punch) punchCovers(ctx, edges);
  if (cast.kind === "snow") {
    const rows = cast.shelfEdges || [];
    for (let index = 0; index < rows.length; index += 1) {
      const edge = rows[index];
      const row = cast.shelves[edgeKey(edge)];
      if (row) paintBlanket(ctx, edge, row, height);
    }
  }
  paintSplashes(ctx, cast);
}

function runSelfCheck() {
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  const noon = skyMoment(new Date(2026, 10, 24, 12, 0), "06:32", "17:45");
  const dawn = skyMoment(new Date(2026, 10, 24, 6, 10), "06:32", "17:45");
  const dusk = skyMoment(new Date(2026, 10, 24, 17, 20), "06:32", "17:45");
  const night = skyMoment(new Date(2026, 10, 24, 22, 0), "06:32", "17:45");
  assert(noon.phase === "day", `noon ${noon.phase}`);
  assert(dawn.phase === "dawn", `dawn ${dawn.phase}`);
  assert(dusk.phase === "dusk", `dusk ${dusk.phase}`);
  assert(night.phase === "night" && night.showSun === false, `night ${night.phase}`);
  assert(noon.sunY < dawn.sunY, "noon sun should sit higher");
  const moon = moonMoment(new Date(2026, 10, 24, 22, 0), "18:10", "06:40");
  assert(moon.x > 0.2 && moon.x < 0.9, "moon travels across the night");
  assert(needsCanvas("sun") && needsCanvas("fog") && needsHit("sun"), "every sky uses the canvas");

  const clouds = createCast({ kind: "cloud", windy: true, heavy: false, width: 360, height: 700 });
  assert(clouds.clouds.length === 6 && clouds.gusts.length === 14, "cloud field");
  const tops = clouds.clouds.map((item) => item.y);
  assert(Math.min.apply(null, tops) < 120 && Math.max.apply(null, tops) > 560, "clouds span the screen");
  const before = clouds.clouds[0].x;
  stepCast(clouds, 0.5);
  assert(clouds.clouds[0].x !== before, "cloud should travel");

  const rain = createCast({ kind: "rain", windy: true, heavy: true, width: 360, height: 700 });
  assert(rain.drops.length === 96, "heavy rain count");
  const drop = rain.drops[0];
  const fall = drop.vy;
  stepCast(rain, 0.05);
  assert(drop.y !== drop.py, "rain should move");
  nudgeCast(rain, 10, 10, 30);
  assert(rain.gustBoost > 0 && rain.gustLeft > 0, "swipe should raise the wind");

  const side = createCast({ kind: "rain", windy: false, heavy: false, width: 360, height: 700 });
  side.drops[0].x = 120;
  side.drops[0].y = 200;
  side.drops[0].px = 120;
  side.drops[0].py = 190;
  side.drops[0].vx = 0;
  side.drops[0].vy = 80;
  stepCast(side, 0.05, [{ left: 40, top: 210, width: 200, height: 120, shelf: true }]);
  assert(side.drops[0].x > 80 && side.drops[0].x < 180, "rain keeps crossing the card");

  const snow = createCast({ kind: "snow", windy: false, heavy: false, width: 300, height: 600 });
  assert(snow.flakes.length === 72, "snow count");
  const frame = frameEdges(300, 600, "snow");
  assert(frame.length === 2 && frame[0].top === 598, "card frame carries a bottom shelf");
  assert(frame[1].top === 8 && frame[1].decor, "top border keeps a decorative snow rim");
  assert(frameEdges(300, 600, "rain").length === 1, "rain does not need a top rim");
  const edge = { left: 20, top: 180, width: 200, height: 80, shelf: true };
  snow.flakes.forEach((flake, index) => {
    if (index === 0) return;
    flake.y = 10;
    flake.py = 10;
    flake.vy = 0;
    flake.gravity = 0;
  });
  snow.flakes[0].x = 80;
  snow.flakes[0].y = 176;
  snow.flakes[0].px = 80;
  snow.flakes[0].py = 168;
  snow.flakes[0].vy = 200;
  snow.flakes[0].vx = 0;
  snow.flakes[0].windage = 0;
  snow.flakes[0].sway = 0;
  stepCast(snow, 0.05, [edge]);
  const row = snow.shelves[edgeKey(edge)];
  assert(row && Math.max.apply(null, row) > 1.4, "snow lands as a ridge");
  const peak = Math.max.apply(null, row);
  brushSnow(snow, 80, 180);
  assert(Math.max.apply(null, snow.shelves[edgeKey(edge)]) < peak, "a brush lowers that stretch");

  const rested = createCast({ kind: "snow", windy: false, heavy: false, width: 200, height: 200 });
  rested.flakes[0].vy = 0;
  rested.flakes[0].gravity = 0;
  const slow = fall;
  assert(slow > 100, "rain already has downward speed");
  const storm = createCast({ kind: "storm", windy: false, heavy: true, width: 300, height: 600 });
  strikeCast(storm);
  assert(storm.flash > 0 && storm.bolt.segments.length > 2, "bolt");

  // 画布铺满整张卡片以后，每种天气、每个时段都要画得出来
  const stub = () => {
    const calls = [];
    const gradient = { addColorStop: (stop, color) => calls.push([stop, color]) };
    const ctx = new Proxy({}, {
      get(target, key) {
        if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
        return (...args) => calls.push([String(key)].concat(args));
      },
      set() {
        return true;
      },
    });
    return { ctx, calls };
  };
  const kinds = ["sun", "cloud", "fog", "rain", "snow", "storm"];
  const phases = ["day", "dawn", "dusk", "night"];
  for (let kindIndex = 0; kindIndex < kinds.length; kindIndex += 1) {
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
      const name = kinds[kindIndex];
      const phase = phases[phaseIndex];
      const card = createCast({ kind: name, windy: true, heavy: name === "storm", width: 320, height: 560 });
      const stubbed = stub();
      paintCast(
        stubbed.ctx,
        card,
        phase,
        { x: 0.3, y: 0.2 },
        frameEdges(320, 560, name),
        { x: 0.7, y: 0.15, phase: "full" }
      );
      const colors = skyColors(name, phase);
      const stops = stubbed.calls.filter((call) => typeof call[0] === "number");
      assert(stops.length >= 3 && stops[0][1] === colors[0] && stops[2][1] === colors[2], `${name} ${phase} paints the card sky`);
    }
  }

  const wetCard = createCast({ kind: "rain", windy: false, heavy: false, width: 320, height: 560 });
  const wetEdges = frameEdges(320, 560, "rain");
  wetCard.drops.forEach((item) => {
    item.gravity = 0;
    item.vy = 0;
    item.vx = 0;
  });
  const hitter = wetCard.drops[0];
  hitter.x = 120;
  hitter.px = 120;
  hitter.y = wetEdges[0].top - 1;
  hitter.py = wetEdges[0].top - 4;
  hitter.vy = 240;
  stepCast(wetCard, 0.02, wetEdges);
  assert(wetCard.splashes.some((splash) => splash.life > 0), "rain splashes on the bottom border");

  const cappedCard = createCast({ kind: "snow", windy: false, heavy: false, width: 320, height: 560 });
  const cappedEdges = frameEdges(320, 560, "snow");
  stepCast(cappedCard, 0.02, cappedEdges);
  assert(Math.max.apply(null, cappedCard.shelves[edgeKey(cappedEdges[1])]) >= 7, "top border shows snow");
  assert(firstShelf({ x: 160, y: 9, py: 4, vy: 200 }, cappedEdges) === null, "top rim lets flakes fall through");

  console.log("sky self-check ok");
}

if (require.main === module) {
  runSelfCheck();
}

module.exports = {
  skyMoment,
  moonMoment,
  moonPhaseKey,
  skyColors,
  clockMinutes,
  frameEdges,
  needsCanvas,
  needsHit,
  createCast,
  stepCast,
  paintCast,
  nudgeCast,
  strikeCast,
  brushSnow,
  pokeFog,
  makeFlakeSprite,
  punchCovers,
};


