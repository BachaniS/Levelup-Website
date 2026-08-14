/* =========================================================
   RESPAWN — 3D world layer
   A single WebGL context that renders the character's stat
   rig (the pentagon PROFILE chart from the app) as a real 3D
   object, plus an ambient particle field and horizon grid.

   The rig is "anchored" to DOM slots: as you scroll, it flies
   between [data-anchor3d] elements and rescales to fit them,
   so the same object serves the hero and the PROFILE section.
   ========================================================= */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const STATS = [
  { key: 'STR', color: 0xef4444, value: 0.92 },
  { key: 'DEX', color: 0xf97316, value: 0.46 },
  { key: 'SPD', color: 0xf59e0b, value: 0.58 },
  { key: 'STM', color: 0xec4899, value: 0.40 },
  { key: 'INT', color: 0x818cf8, value: 0.74 },
];

const RIG_RADIUS = 2.2;          // world units, matches a "1.0" stat
const PLANE_DEPTH = 10;          // distance from camera the rig lives at
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Pentagon vertex direction, STR first at the top then clockwise — matching
   the app's PROFILE chart. Y is negated because WebGL is +Y-up while the
   screen-space angle convention here (and the 2D fallback) is +Y-down. */
function dir(i, n = 5) {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
  return new THREE.Vector2(Math.cos(a), -Math.sin(a));
}

/* ---------- sprite textures (generated, no assets) ---------- */
function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text, hex) {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = '600 44px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = hex;
  g.shadowBlur = 10;
  g.fillStyle = hex;
  g.fillText(text, w / 2, h / 2);
  g.shadowBlur = 0;
  /* draw twice unshadowed so the glyphs stay crisp under bloom */
  g.fillText(text, w / 2, h / 2);
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function initScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0e0f16, 0.028);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 0, 0);

  /* ================= the stat rig ================= */
  const rig = new THREE.Group();
  const spin = new THREE.Group();       // continuous slow yaw
  rig.add(spin);
  scene.add(rig);

  const softBlue = 0x2a4a7f;

  /* concentric guide pentagons at 25 / 50 / 75 / 100% */
  [0.25, 0.5, 0.75, 1].forEach((r, idx) => {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const d = dir(i % 5);
      pts.push(new THREE.Vector3(d.x * RIG_RADIUS * r, d.y * RIG_RADIUS * r, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: softBlue,
      transparent: true,
      opacity: idx === 3 ? 0.85 : 0.4,
    });
    spin.add(new THREE.Line(geo, mat));
  });

  /* spokes out to each stat axis */
  {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const d = dir(i);
      pts.push(new THREE.Vector3(0, 0, 0));
      pts.push(new THREE.Vector3(d.x * RIG_RADIUS, d.y * RIG_RADIUS, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    spin.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: softBlue, transparent: true, opacity: 0.45,
    })));
  }

  /* the player's filled stat shape — triangle fan from centre */
  const fanCount = 5;
  const fanGeo = new THREE.BufferGeometry();
  const fanPos = new Float32Array(fanCount * 3 * 3);
  fanGeo.setAttribute('position', new THREE.BufferAttribute(fanPos, 3));
  const fanMesh = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  spin.add(fanMesh);

  /* fat outline around the stat shape */
  const outlineGeo = new LineGeometry();
  outlineGeo.setPositions(new Array((5 + 1) * 3).fill(0));
  const outlineMat = new LineMaterial({
    color: 0x60a5fa,
    linewidth: 2.4,          // in px thanks to LineMaterial
    transparent: true,
    opacity: 0.95,
    dashed: false,
  });
  const outline = new Line2(outlineGeo, outlineMat);
  outline.computeLineDistances();
  spin.add(outline);

  /* stat nodes: solid dot + additive halo + pixel label */
  const glowTex = glowTexture();
  const nodes = STATS.map((s) => {
    const group = new THREE.Group();

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 16),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 1 })
    );
    group.add(dot);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: s.color,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    halo.scale.setScalar(0.55);
    group.add(halo);

    spin.add(group);

    const hex = '#' + s.color.toString(16).padStart(6, '0');
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(s.key, hex),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }));
    label.scale.set(1.05, 0.52, 1);
    spin.add(label);

    return { def: s, group, halo, label, current: 0.12, target: s.value };
  });

  /* slowly counter-rotating outer ring, for depth */
  const ringPts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * RIG_RADIUS * 1.32, Math.sin(a) * RIG_RADIUS * 1.32, 0));
  }
  const ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0x1d4ed8, transparent: true, opacity: 0.5 })
  );
  rig.add(ring);

  /* tick marks on the ring */
  {
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r1 = RIG_RADIUS * 1.36, r2 = RIG_RADIUS * (i % 5 === 0 ? 1.46 : 1.41);
      pts.push(new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, 0));
      pts.push(new THREE.Vector3(Math.cos(a) * r2, Math.sin(a) * r2, 0));
    }
    const ticks = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.38 })
    );
    rig.add(ticks);
  }

  /* level-up shockwave rings (pooled) */
  const waves = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(RIG_RADIUS * 0.98, RIG_RADIUS * 1.02, 64),
      new THREE.MeshBasicMaterial({
        color: 0x93c5fd, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    m.material.userData.noFade = true;   // waves drive their own opacity
    rig.add(m);
    waves.push({ mesh: m, t: -1 });
  }

  /* ================= ambient field ================= */
  const starCount = window.innerWidth < 760 ? 700 : 1800;
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 46;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
    starPos[i * 3 + 2] = -Math.random() * 34 - 2;
    starSeed[i] = Math.random() * Math.PI * 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x7aaef8,
    size: 0.07,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    map: glowTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  scene.add(stars);

  /* horizon grid — the "world floor" */
  const grid = new THREE.GridHelper(90, 60, 0x2563eb, 0x14306b);
  grid.material.transparent = true;
  grid.material.opacity = 0.32;
  grid.position.set(0, -7.5, -14);
  scene.add(grid);

  const grid2 = grid.clone();
  grid2.material = grid.material.clone();
  grid2.material.opacity = 0.16;
  grid2.position.set(0, 8.5, -18);
  grid2.rotation.x = Math.PI;
  scene.add(grid2);

  /* ================= post ================= */
  const allowBloom = !reduceMotion && window.innerWidth >= 900 &&
    !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  /* Only pay for a post chain when bloom is actually on; otherwise render
     straight to screen so colour management stays on three's fast path. */
  let composer = null;
  let bloom = null;
  if (allowBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.62, 0.14);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  /* Every rig material fades together as the rig hands off between anchors,
     so it never lingers half-visible over unrelated copy. */
  const fadeables = [];
  rig.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (m.userData.noFade) return;
      m.transparent = true;
      fadeables.push({ mat: m, base: m.opacity });
    });
  });

  /* ================= anchoring to DOM ================= */
  let anchors = [];
  function collectAnchors() {
    anchors = Array.from(document.querySelectorAll('[data-anchor3d]'));
  }
  collectAnchors();

  const viewSize = { w: 1, h: 1 };
  function recomputeView() {
    viewSize.h = 2 * Math.tan((camera.fov * Math.PI) / 180 / 2) * PLANE_DEPTH;
    viewSize.w = viewSize.h * camera.aspect;
  }

  /* where the rig wants to be, in world space */
  const want = { x: 0, y: 0, scale: 1, opacity: 1 };

  function updateTarget() {
    if (!anchors.length) return;
    const vh = window.innerHeight;
    const mid = vh / 2;

    /* the anchor whose centre is nearest the viewport centre wins */
    let best = null, bestDist = Infinity;
    for (const el of anchors) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -vh * 0.4 || r.top > vh * 1.4) continue;
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestDist) { bestDist = d; best = { el, r }; }
    }
    if (!best) { want.opacity = 0; return; }

    const { r } = best;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    /* screen px -> NDC -> world at PLANE_DEPTH */
    const ndcX = (cx / window.innerWidth) * 2 - 1;
    const ndcY = -((cy / window.innerHeight) * 2 - 1);
    want.x = (ndcX * viewSize.w) / 2;
    want.y = (ndcY * viewSize.h) / 2;

    /* fit the rig's full extent (ring included) into the slot */
    const fitPx = Math.min(r.width, r.height);
    const worldFit = (fitPx / window.innerWidth) * viewSize.w;
    want.scale = worldFit / (RIG_RADIUS * 2 * 1.5);

    /* fade near the very top/bottom of travel so hand-offs feel intentional */
    const off = Math.min(1, bestDist / (vh * 0.9));
    want.opacity = 1 - off * 0.75;
  }

  /* ================= input ================= */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (window.matchMedia('(pointer:fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  /* ================= resize ================= */
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 760 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    outlineMat.resolution.set(w, h);
    recomputeView();
    collectAnchors();
    updateTarget();
  }
  window.addEventListener('resize', resize);
  resize();

  /* start the rig at its anchor so it doesn't fly in from 0,0 */
  rig.position.set(want.x, want.y, 0);
  rig.scale.setScalar(want.scale);

  /* ================= public API ================= */
  let paused = false;
  const api = {
    /* punch a shockwave + briefly overdrive bloom */
    pulse() {
      const free = waves.find((w) => w.t < 0) || waves[0];
      free.t = 0;
      if (bloom) bloom.strength = 1.6;
    },
    /* drive the radar shape from outside (e.g. quest completions) */
    setStat(key, value) {
      const n = nodes.find((x) => x.def.key === key);
      if (n) n.target = THREE.MathUtils.clamp(value, 0.08, 1);
    },
    boostAll(mult) {
      nodes.forEach((n) => { n.target = THREE.MathUtils.clamp(n.target * mult, 0.08, 1); });
    },
    setPaused(v) { paused = v; },
  };

  /* ================= loop ================= */
  const clock = new THREE.Clock();
  const fanArr = fanGeo.attributes.position.array;
  const outlineArr = new Array((5 + 1) * 3).fill(0);
  let scrollT = 0;
  let fade = 0;

  function frame() {
    requestAnimationFrame(frame);
    if (paused) return;

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    updateTarget();

    /* pointer easing */
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    /* scroll drives a subtle world drift */
    const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
    scrollT += ((window.scrollY / maxScroll) - scrollT) * 0.08;

    /* rig follows its DOM anchor */
    rig.position.x += (want.x - rig.position.x) * 0.09;
    rig.position.y += (want.y - rig.position.y) * 0.09;
    rig.position.z = -PLANE_DEPTH + Math.sin(t * 0.6) * 0.25;
    const s = rig.scale.x + (want.scale - rig.scale.x) * 0.09;
    rig.scale.setScalar(s);

    /* tilt toward the pointer, plus a lazy idle sway */
    const idleX = Math.sin(t * 0.45) * 0.09;
    const idleY = Math.cos(t * 0.35) * 0.12;
    rig.rotation.x += ((pointer.y * 0.35 + idleX) - rig.rotation.x) * 0.05;
    rig.rotation.y += ((-pointer.x * 0.5 + idleY) - rig.rotation.y) * 0.05;
    /* Only a slight sway — a full spin would carry STR/DEX/... away from the
       fixed axis positions they occupy in the app. */
    spin.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.28) * 0.05;
    ring.rotation.z = reduceMotion ? 0 : -t * 0.14;

    /* animate stat values, rebuild the shape */
    for (let i = 0; i < 5; i++) {
      const n = nodes[i];
      n.current += (n.target - n.current) * 0.045;

      const d = dir(i);
      const r = RIG_RADIUS * n.current;
      const px = d.x * r, py = d.y * r;

      n.group.position.set(px, py, 0.02);
      const puls = 0.55 + Math.sin(t * 2 + i) * 0.08;
      n.halo.scale.setScalar(puls);

      const lr = RIG_RADIUS * 1.16;
      n.label.position.set(d.x * lr, d.y * lr, 0.02);

      outlineArr[i * 3] = px;
      outlineArr[i * 3 + 1] = py;
      outlineArr[i * 3 + 2] = 0.01;
    }
    /* close the loop */
    outlineArr[15] = outlineArr[0];
    outlineArr[16] = outlineArr[1];
    outlineArr[17] = outlineArr[2];
    outlineGeo.setPositions(outlineArr);

    /* triangle fan */
    for (let i = 0; i < fanCount; i++) {
      const a = i, b = (i + 1) % 5;
      const o = i * 9;
      fanArr[o] = 0; fanArr[o + 1] = 0; fanArr[o + 2] = 0;
      fanArr[o + 3] = outlineArr[a * 3];
      fanArr[o + 4] = outlineArr[a * 3 + 1];
      fanArr[o + 5] = 0;
      fanArr[o + 6] = outlineArr[b * 3];
      fanArr[o + 7] = outlineArr[b * 3 + 1];
      fanArr[o + 8] = 0;
    }
    fanGeo.attributes.position.needsUpdate = true;
    fanGeo.computeBoundingSphere();

    /* shockwaves */
    for (const w of waves) {
      if (w.t < 0) continue;
      w.t += dt * 1.5;
      if (w.t >= 1) { w.t = -1; w.mesh.material.opacity = 0; continue; }
      const k = w.t;
      w.mesh.scale.setScalar(0.35 + k * 1.5);
      w.mesh.material.opacity = (1 - k) * 0.75;
    }
    if (bloom && bloom.strength > 0.72) {
      bloom.strength = Math.max(0.72, bloom.strength - dt * 1.4);
    }

    /* ambient drift */
    stars.rotation.y = t * 0.012 + pointer.x * 0.05;
    stars.rotation.x = pointer.y * 0.04;
    stars.position.z = -2 + scrollT * 12;
    grid.position.z = -14 + ((scrollT * 40) % 3);
    grid2.position.z = -18 + ((scrollT * 40) % 3);

    /* global fade so the rig never fights the copy */
    fade += (want.opacity - fade) * 0.08;
    rig.visible = fade > 0.02;
    if (rig.visible) {
      for (const f of fadeables) f.mat.opacity = f.base * fade;
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }
  frame();

  /* pause the loop when the tab is hidden */
  document.addEventListener('visibilitychange', () => api.setPaused(document.hidden));

  return api;
}
