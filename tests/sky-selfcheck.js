/**
 * sky.js 的自测：验证天色时段、太阳月亮位置、云雨雪雾的粒子与积雪这些几何计算。
 * 真机跑不了界面，只能在命令行验证：
 *   node tests/sky-selfcheck.js
 * 这个文件不进小程序包（不在 miniprogram/ 里）。
 */
const {
  skyMoment,
  moonMoment,
  needsCanvas,
  needsHit,
  createCast,
  stepCast,
  nudgeCast,
  frameEdges,
  skyColors,
  paintCast,
  strikeCast,
  brushSnow,
  firstShelf,
} = require("../miniprogram/utils/sky.js");

/** 和 sky.js 里的写法保持一致：把一条边框折算成积雪行的 key。 */
function edgeKey(edge) {
  return `${Math.round(edge.left)}:${Math.round(edge.top / 12)}`;
}

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
