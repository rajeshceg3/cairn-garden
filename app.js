/* Cairn - a quiet minute.
   Stack stones on a dawn mountainside. One new stone arrives each day.
   Physics: matter-js (vendored, MIT). Rendering: canvas 2d, hand-inked style.
   Sound: Web Audio, synthesized (no assets). All state stays on this device. */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var hintEl = document.getElementById('hint');
  var dateEl = document.getElementById('dateline');
  var soundBtn = document.getElementById('soundToggle');

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- seeded rng ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var now = new Date();
  var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  var skyRng = mulberry32(now.getFullYear() * 1000 + dayOfYear);

  // ---------- persistence ----------
  var STORE_KEY = 'cairn.v1';
  var store = { stones: [], lastDawn: '', sound: 'unset', visited: false };
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) { var parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') store = Object.assign(store, parsed); }
  } catch (e) { /* private mode etc - play without saving */ }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var saveDirty = false, saveTimer = 0;
  function markDirty() {
    saveDirty = true;
    if (!saveTimer) saveTimer = setTimeout(flushSave, 1500);
  }
  function flushSave() {
    saveTimer = 0;
    if (!saveDirty) return;
    saveDirty = false;
    try {
      store.stones = stones.map(function (s) {
        return { seed: s.plugin.seed, kind: s.plugin.kind, x: Math.round(s.position.x), y: Math.round(s.position.y), angle: +s.angle.toFixed(3) };
      });
      store.visited = store.visited || firstStackDone;
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* ignore */ }
  }
  window.addEventListener('visibilitychange', function () { if (document.hidden) flushSave(); });
  window.addEventListener('pagehide', flushSave);

  // ---------- sizing ----------
  var W = 0, H = 0, DPR = 1, groundY = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    groundY = Math.round(H * 0.84);
    rebuildWorld();
    buildScenery();
  }

  // ---------- physics ----------
  var engine = Matter.Engine.create({ enableSleeping: true });
  engine.positionIterations = 10; engine.velocityIterations = 8;
  var world = engine.world;
  var stones = [];      // dynamic stone bodies
  var statics = [];     // ground / base / walls
  var BASE_W = 150;

  function rebuildWorld() {
    var i;
    for (i = 0; i < statics.length; i++) Matter.Composite.remove(world, statics[i]);
    statics = [];
    var baseX = W / 2;
    // shallow valley: three static segments so runaway stones roll back toward the middle
    var g1 = Matter.Bodies.rectangle(baseX, groundY + 60, W * 2.4, 120, { isStatic: true, friction: 0.95 });
    var wl = Matter.Bodies.rectangle(baseX - W * 0.85, groundY - 80, W, 140, { isStatic: true, angle: 0.5, friction: 0.9 });
    var wr = Matter.Bodies.rectangle(baseX + W * 0.85, groundY - 80, W, 140, { isStatic: true, angle: -0.5, friction: 0.9 });
    // cairn base slab
    var base = Matter.Bodies.rectangle(baseX, groundY - 12, BASE_W, 26, {
      isStatic: true, friction: 1.0, chamfer: { radius: 10 }, plugin: { base: true }
    });
    statics.push(g1, wl, wr, base);
    Matter.Composite.add(world, statics);
    // keep existing stones inside the new frame
    for (i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.position.x < -80 || s.position.x > W + 80 || s.position.y > H + 200) {
        Matter.Composite.remove(world, s);
        stones.splice(i, 1); i--;
      }
    }
  }

  var STONE_COLORS = [
    ['#5a6085', '#474c6b'], ['#6b6f8c', '#555a76'], ['#4a4e68', '#3c4059'],
    ['#737789', '#5c6076'], ['#636a7e', '#4e5468']
  ];
  var DAWN_COLORS = ['#c98d5e', '#a86b44'];

  function stoneVertices(seed, w, h) {
    var rng = mulberry32(seed);
    var n = 6 + Math.floor(rng() * 3);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = 0.82 + rng() * 0.26;
      pts.push({ x: Math.cos(a) * w * 0.5 * r, y: Math.sin(a) * h * 0.5 * r });
    }
    return pts;
  }

  function makeStone(seed, kind, x, y) {
    var rng = mulberry32(seed);
    var w = 44 + rng() * 26, h = w * (0.62 + rng() * 0.22);
    var body = Matter.Bodies.fromVertices(x, y, [stoneVertices(seed, w, h)], {
      friction: 0.92, frictionStatic: 1.4, restitution: 0.04, density: 0.0014,
      chamfer: { radius: 7 }
    });
    if (!body) return null;
    body.plugin = { seed: seed, kind: kind || 'plain', settled: false };
    Matter.Composite.add(world, body);
    stones.push(body);
    return body;
  }

  // ---------- scree pile ----------
  function pileCount() {
    var n = 0;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.position.y > groundY - 46 && s.position.x < W * 0.38) n++;
    }
    return n;
  }
  var respawnAt = 0;
  function maybeRespawnPile(t) {
    if (pileCount() >= 3 || t < respawnAt) return;
    respawnAt = t + 1800;
    var seed = (Math.random() * 1e9) | 0;
    makeStone(seed, 'plain', 90 + Math.random() * (W * 0.18), groundY - 30);
  }

  // ---------- input: drag stones ----------
  var mouse = Matter.Mouse.create(canvas);
  var mouseConstraint = Matter.MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: { stiffness: 0.12, damping: 0.08, angularStiffness: 0.04 }
  });
  Matter.Composite.add(world, mouseConstraint);
  // cap fling speed so throws feel weighted, not wild
  Matter.Events.on(engine, 'afterUpdate', function () {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.speed > 26) {
        var k = 26 / s.speed;
        Matter.Body.setVelocity(s, { x: s.velocity.x * k, y: s.velocity.y * k });
      }
    }
  });

  // ---------- audio ----------
  var AC = null, master = null, bowlGain = null, bowlOscs = [], droneNodes = [], soundOn = false;
  function initAudio() {
    if (AC) return;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    AC = new Ctor();
    master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    // singing bowl: fundamental + inharmonic partials, always running, gated by bowlGain
    bowlGain = AC.createGain(); bowlGain.gain.value = 0; bowlGain.connect(master);
    [[196.0, 1.0], [196.0 * 2.72, 0.38], [196.0 * 5.41, 0.13]].forEach(function (p) {
      var o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = p[0];
      var g = AC.createGain(); g.gain.value = p[1];
      o.connect(g); g.connect(bowlGain); o.start();
      bowlOscs.push(o);
    });
    // ambient drone: two low detuned sines + soft wind noise
    var dg = AC.createGain(); dg.gain.value = 0.05; dg.connect(master);
    [[65.41, 1], [98.0, 0.7], [65.41 * 1.005, 0.5]].forEach(function (p) {
      var o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = p[0];
      var g = AC.createGain(); g.gain.value = p[1] * 0.5;
      o.connect(g); g.connect(dg); o.start();
      droneNodes.push(o);
    });
    var lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
    var lfoG = AC.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(dg.gain); lfo.start();
    droneNodes.push(lfo);
    var noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var noise = AC.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    var nf = AC.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 320; nf.Q.value = 0.4;
    var ng = AC.createGain(); ng.gain.value = 0.012;
    noise.connect(nf); nf.connect(ng); ng.connect(master); noise.start();
    droneNodes.push(noise);
    scheduleBird();
  }
  function scheduleBird() {
    if (!AC) return;
    setTimeout(function () {
      if (soundOn && AC && AC.state === 'running') chirp();
      scheduleBird();
    }, 16000 + Math.random() * 30000);
  }
  function chirp() {
    var t = AC.currentTime;
    var n = 2 + Math.floor(Math.random() * 3);
    for (var i = 0; i < n; i++) {
      var o = AC.createOscillator(), g = AC.createGain();
      var f0 = 2300 + Math.random() * 1200;
      var t0 = t + i * (0.14 + Math.random() * 0.06);
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.3), t0 + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.85, t0 + 0.1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + 0.13);
    }
  }
  function knock(strength) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var o = AC.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(88 + Math.random() * 22, t);
    var g = AC.createGain();
    var v = Math.min(0.5, 0.06 + strength * 0.4);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
    // click of stone on stone
    var nb = AC.createBuffer(1, 900, AC.sampleRate);
    var dd = nb.getChannelData(0);
    for (var i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / dd.length);
    var ns = AC.createBufferSource(); ns.buffer = nb;
    var bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750 + Math.random() * 350; bp.Q.value = 1.1;
    var ng2 = AC.createGain(); ng2.gain.value = v * 0.8;
    ns.connect(bp); bp.connect(ng2); ng2.connect(master); ns.start(t);
  }
  Matter.Events.on(engine, 'collisionStart', function (ev) {
    var pairs = ev.pairs;
    for (var i = 0; i < pairs.length; i++) {
      var a = pairs[i].bodyA, b = pairs[i].bodyB;
      var aStone = stones.indexOf(a) >= 0, bStone = stones.indexOf(b) >= 0;
      if (!aStone && !bStone) continue;
      var rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (rv > 1.1) knock(Math.min(1, rv / 14));
    }
  });

  window.__cairn = function () {
    return { audio: AC ? AC.state : 'not-created', stones: stones.length,
             bowl: +bowlTarget.toFixed(3) };
  };
  function setSound(on) {
    soundOn = on;
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundBtn.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
    soundBtn.classList.remove('attn');
    store.sound = on ? 'on' : 'off'; markDirty();
    if (on) {
      initAudio();
      if (AC && AC.state === 'suspended') AC.resume();
      if (master) master.gain.setTargetAtTime(0.9, AC.currentTime, 0.4);
    } else if (master && AC) {
      master.gain.setTargetAtTime(0, AC.currentTime, 0.15);
    }
  }
  soundBtn.addEventListener('click', function () { setSound(!soundOn); });
  if (store.sound === 'on') { soundBtn.classList.add('attn'); }
  else if (store.sound === 'unset') { soundBtn.classList.add('attn'); }
  soundBtn.setAttribute('aria-pressed', 'false');

  // ---------- singing bowl ----------
  var bowl = { x: 0, y: 0, r: 40 };
  function bowlLayout() {
    bowl.x = Math.min(W - 92, W * 0.78);
    bowl.y = groundY - 58;
    bowl.r = Math.max(30, Math.min(44, W * 0.055));
  }
  var singing = false, singPointer = null, lastAngle = 0, bowlTarget = 0;
  function angleAround(x, y) { return Math.atan2(y - bowl.y, x - bowl.x); }
  canvas.addEventListener('pointerdown', function (e) {
    if (Math.hypot(e.clientX - bowl.x, e.clientY - bowl.y) < bowl.r + 14) {
      singing = true; singPointer = e.pointerId; lastAngle = angleAround(e.clientX, e.clientY);
      if (!soundOn) setSound(true);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!singing || e.pointerId !== singPointer) return;
    var a = angleAround(e.clientX, e.clientY);
    var d = a - lastAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    lastAngle = a;
    bowlTarget = Math.min(0.85, bowlTarget + Math.abs(d) * 0.55);
  });
  function endSing(e) {
    if (e.pointerId === singPointer) { singing = false; singPointer = null; }
  }
  canvas.addEventListener('pointerup', endSing);
  canvas.addEventListener('pointercancel', endSing);

  // ---------- scenery (prerendered offscreen, rebuilt on resize/day) ----------
  var skyCanvas = null, ridgeFar = null, ridgeMid = null, ridgeNear = null, grain = null;
  var skyHue = 232, dawnHue = 32;
  function buildScenery() {
    skyHue = 222 + skyRng() * 30;
    dawnHue = 24 + skyRng() * 22;
    var light = 0.85 + skyRng() * 0.3;

    skyCanvas = document.createElement('canvas');
    skyCanvas.width = W; skyCanvas.height = H;
    var c = skyCanvas.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, 'hsl(' + skyHue + ',38%,' + Math.round(13 * light) + '%)');
    g.addColorStop(0.55, 'hsl(' + Math.round(326 + skyRng() * 22) + ',30%,' + Math.round(27 * light) + '%)');
    g.addColorStop(1, 'hsl(' + dawnHue + ',48%,' + Math.round(46 * light) + '%)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // morning star, fades on some days
    if (skyRng() > 0.4) {
      var sx = skyRng() * W, sy = skyRng() * H * 0.3;
      c.fillStyle = 'rgba(244,239,230,0.8)';
      c.beginPath(); c.arc(sx, sy, 1.3, 0, 7); c.fill();
    }

    function ridge(peaks, yBase, amp, hue, sat, li, seed) {
      var rc = document.createElement('canvas');
      var W2 = W + 80;
      rc.width = W2; rc.height = H;
      var r = rc.getContext('2d');
      var rng = mulberry32(seed);
      var ys = [];
      for (var j = 0; j <= peaks; j++) ys.push(yBase - rng() * amp - Math.sin(j * 1.7 + (seed % 5)) * amp * 0.35);
      r.beginPath(); r.moveTo(0, H);
      r.lineTo(0, ys[0]);
      for (var i = 1; i <= peaks; i++) {
        var x0 = ((i - 1) / peaks) * W2, x1 = (i / peaks) * W2;
        var mx = (x0 + x1) / 2;
        r.quadraticCurveTo(x0, ys[i - 1], mx, (ys[i - 1] + ys[i]) / 2);
      }
      r.lineTo(W2, ys[peaks]);
      r.lineTo(W2, H); r.closePath();
      r.fillStyle = 'hsl(' + hue + ',' + sat + '%,' + li + '%)';
      r.fill();
      return rc;
    }
    ridgeFar = ridge(6, groundY - H * 0.30, H * 0.10, skyHue, 26, Math.round(24 * light), 11 + dayOfYear);
    ridgeMid = ridge(7, groundY - H * 0.17, H * 0.09, skyHue, 22, Math.round(18 * light), 71 + dayOfYear);
    ridgeNear = ridge(5, groundY - H * 0.065, H * 0.06, skyHue, 20, Math.round(14 * light), 131 + dayOfYear);

    // paper grain
    grain = document.createElement('canvas');
    grain.width = 128; grain.height = 128;
    var gc = grain.getContext('2d');
    var img = gc.createImageData(128, 128);
    var grng = mulberry32(7);
    for (var p = 0; p < img.data.length; p += 4) {
      var v = 200 + grng() * 55;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 9 + grng() * 12;
    }
    gc.putImageData(img, 0, 0);
  }

  // stone sprite cache
  var spriteCache = {};
  function stoneSprite(body) {
    var key = body.plugin.seed + ':' + body.plugin.kind;
    if (spriteCache[key]) return spriteCache[key];
    var verts = body.vertices;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    verts.forEach(function (v) {
      minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
    });
    var pad = 8, w = Math.ceil(maxX - minX) + pad * 2, h = Math.ceil(maxY - minY) + pad * 2;
    var sc = document.createElement('canvas');
    sc.width = w; sc.height = h;
    var c = sc.getContext('2d');
    c.translate(w / 2, h / 2);
    var origin = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    var cols = body.plugin.kind === 'dawn' ? DAWN_COLORS : STONE_COLORS[(body.plugin.seed >>> 3) % STONE_COLORS.length];
    var lg = c.createLinearGradient(0, minY - origin.y, 0, maxY - origin.y);
    lg.addColorStop(0, cols[0]); lg.addColorStop(1, cols[1]);
    c.beginPath();
    verts.forEach(function (v, i) { var x = v.x - origin.x, y = v.y - origin.y; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath();
    c.fillStyle = lg; c.fill();
    // hatch shading along the lower edge
    c.save(); c.clip();
    var rng = mulberry32(body.plugin.seed);
    c.strokeStyle = 'rgba(20,22,38,0.16)'; c.lineWidth = 1;
    for (var i = 0; i < 9; i++) {
      var hx = (rng() - 0.5) * (maxX - minX), hy = (maxY - origin.y) * (0.15 + rng() * 0.5);
      c.beginPath(); c.moveTo(hx - 5 - rng() * 4, hy + 4); c.lineTo(hx + 5 + rng() * 4, hy - 4); c.stroke();
    }
    c.restore();
    // ink outline with a hand-drawn wobble: stroke the path twice slightly offset
    c.strokeStyle = 'rgba(28,31,50,0.9)'; c.lineWidth = 1.7; c.lineJoin = 'round'; c.stroke();
    c.translate(0.7, 0.6);
    c.strokeStyle = 'rgba(28,31,50,0.25)'; c.lineWidth = 1; c.stroke();
    var sprite = { canvas: sc, origin: origin };
    spriteCache[key] = sprite;
    return sprite;
  }

  // ---------- text overlays ----------
  function showHint(text, holdMs) {
    hintEl.textContent = text;
    hintEl.classList.add('show');
    clearTimeout(showHint.t);
    if (holdMs) showHint.t = setTimeout(function () { hintEl.classList.remove('show'); }, holdMs);
  }
  dateEl.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  requestAnimationFrame(function () {
    dateEl.classList.add('show');
    setTimeout(function () { dateEl.classList.remove('show'); }, 7000);
  });
  if (!store.visited) showHint('drag a stone onto the cairn');
  else if (store.lastDawn !== todayStr()) showHint('a new stone for today', 6000);

  // ---------- initial world ----------
  resize();
  bowlLayout();
  window.addEventListener('resize', function () { resize(); bowlLayout(); });

  if (store.stones.length) {
    store.stones.forEach(function (s) { makeStone(s.seed, s.kind, s.x, s.y); });
  } else {
    for (var i = 0; i < 3; i++) makeStone(1000 + i * 37, 'plain', 96 + i * 56, groundY - 30 - (i % 2) * 20);
  }
  var dawnPending = store.lastDawn !== todayStr();
  if (dawnPending) {
    var ds = makeStone((Math.random() * 1e9) | 0, 'dawn', 80 + Math.random() * 40, groundY - 110);
    if (ds) {
      ds.plugin.fresh = true;
      store.lastDawn = todayStr(); markDirty();
      if (store.visited) showHint('today\u2019s stone has arrived', 5000);
    }
  }

  // first-stack detection closes the onboarding hint
  var firstStackDone = store.stones.length > 3;
  Matter.Events.on(engine, 'afterUpdate', function () {
    if (firstStackDone) return;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (Math.abs(s.position.x - W / 2) < BASE_W && s.position.y < groundY - 34 && s.speed < 0.4) {
        firstStackDone = true;
        showHint('quiet, isn\u2019t it', 3500);
        break;
      }
    }
  });

  // clean fallen stones
  setInterval(function () {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.position.x < -140 || s.position.x > W + 140 || s.position.y > H + 260) {
        Matter.Composite.remove(world, s);
        delete spriteCache[s.plugin.seed + ':' + s.plugin.kind];
        stones.splice(i, 1); i--;
        markDirty();
      }
    }
  }, 2500);

  // ---------- pointer parallax ----------
  var parX = 0, parTarget = 0;
  canvas.addEventListener('pointermove', function (e) {
    if (!mouseConstraint.body && !reducedMotion) parTarget = (e.clientX / W - 0.5) * 2;
  });

  // ---------- render ----------
  var mistDrift = 0;
  function draw(t) {
    // physics
    Matter.Engine.update(engine, 1000 / 60);
    maybeRespawnPile(t);

    parX += (parTarget - parX) * 0.04;
    mistDrift += reducedMotion ? 0 : 0.12;

    // sky
    ctx.drawImage(skyCanvas, 0, 0);
    // ridges with parallax
    ctx.drawImage(ridgeFar, -40 + parX * -5, 0);
    ctx.drawImage(ridgeMid, -40 + parX * -9, 0);
    ctx.drawImage(ridgeNear, -40 + parX * -14, 0);

    // ground band
    var gg = ctx.createLinearGradient(0, groundY - 30, 0, H);
    gg.addColorStop(0, 'hsl(' + skyHue + ',22%,16%)');
    gg.addColorStop(1, 'hsl(' + skyHue + ',26%,10%)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, groundY - 28, W, H - groundY + 28);
    ctx.strokeStyle = 'rgba(244,239,230,0.14)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, groundY - 27); ctx.lineTo(W, groundY - 27); ctx.stroke();

    // mist band above the ground line
    if (!reducedMotion) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#e9e4da';
      for (var i = 0; i < 3; i++) {
        var mx = ((mistDrift * (0.4 + i * 0.2) + i * W * 0.45) % (W + 320)) - 160;
        ctx.beginPath();
        ctx.ellipse(mx, groundY - 40 - i * 26, 210, 12 + i * 4, 0, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }

    // base slab
    ctx.save();
    ctx.fillStyle = 'hsl(' + skyHue + ',18%,20%)';
    ctx.strokeStyle = 'rgba(28,31,50,0.9)'; ctx.lineWidth = 1.6;
    var bx = W / 2 - BASE_W / 2, by = groundY - 25;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, BASE_W, 26, 10); else ctx.rect(bx, by, BASE_W, 26);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // bowl rock + bowl
    ctx.save();
    ctx.fillStyle = 'hsl(' + skyHue + ',16%,19%)';
    ctx.strokeStyle = 'rgba(28,31,50,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(bowl.x, groundY - 16, bowl.r + 16, 22, 0, 0, 7);
    ctx.fill(); ctx.stroke();
    var bg = ctx.createLinearGradient(bowl.x, bowl.y - bowl.r, bowl.x, bowl.y + bowl.r * 0.4);
    bg.addColorStop(0, '#b58a4e'); bg.addColorStop(0.6, '#8a6434'); bg.addColorStop(1, '#5f421f');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(bowl.x, bowl.y, bowl.r, bowl.r * 0.42, 0, 0, Math.PI);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(bowl.x, bowl.y, bowl.r, bowl.r * 0.4, 0, Math.PI, 0);
    ctx.fillStyle = '#3d2c14'; ctx.fill();
    ctx.strokeStyle = 'rgba(230,200,140,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    // ring shimmer while singing
    if (bowlTarget > 0.05) {
      ctx.globalAlpha = Math.min(0.5, bowlTarget);
      ctx.strokeStyle = 'rgba(240,214,160,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(bowl.x, bowl.y, bowl.r + 4 + Math.sin(t / 90) * 2, bowl.r * 0.42 + 3, 0, 0, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // stones
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      var spr = stoneSprite(s);
      ctx.save();
      ctx.translate(s.position.x, s.position.y);
      ctx.rotate(s.angle);
      ctx.drawImage(spr.canvas, -spr.canvas.width / 2, -spr.canvas.height / 2);
      if (s.plugin.fresh) {
        ctx.globalAlpha = 0.35 + Math.sin(t / 300) * 0.15;
        ctx.strokeStyle = 'rgba(240,205,140,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, spr.canvas.width * 0.5, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }

    // grain overlay
    ctx.save();
    ctx.globalAlpha = 0.5;
    var pat = ctx.createPattern(grain, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // bowl loudness decay
    bowlTarget *= singing ? 0.985 : 0.965;
    if (bowlGain && AC) bowlGain.gain.setTargetAtTime(bowlTarget, AC.currentTime, 0.08);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
