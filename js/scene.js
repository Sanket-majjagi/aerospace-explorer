/*
 * scene.js — Three.js scene: procedural textures, bodies, effects, animation.
 * HOW TO CHANGE:
 *   • Add a new layer/toggle: create meshes, add to a Group, wire visibility
 *     to state.showXxx in the subscriber at bottom.
 *   • Change camera fly time: edit CAMERA_FLY_DURATION_MS.
 *   • Add planet texture: add a case in generateTexture().
 *   • Change bloom: edit BLOOM_PARAMS.
 *   • Change speed range: handled in ui.js slider; scene just reads state.speed.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BODIES, BODY_MAP } from './data.js';
import { getState, setState, subscribe } from './state.js';

/* ── Constants ───────────────────────────────────────── */
const CAMERA_FLY_DURATION_MS = 1800;
const BLOOM_PARAMS = { strength: 1.2, radius: 0.6, threshold: 0.15 };
const TEX_SIZE = 256;
const TRAIL_LENGTH = 180;
const ASTEROID_COUNT_HIGH = 2500;
const ASTEROID_COUNT_LOW = 600;
const STAR_COUNT = [4000, 3000, 2000]; // 3 layers

/* ── Module state ────────────────────────────────────── */
let renderer, scene, camera, controls, composer, bloomPass, css2dRenderer;
let clock, simTime = 0;
let bodyMeshes = {};   // id -> { group, mesh, orbit, trail, label, cloudMesh, atmosphereMesh, ringMesh, moonGroup }
let asteroidMesh, asteroidGroup;
let starLayers = [];
let galaxyPoints, nebulaSprites = [];
let blackHoleGroup;
let sunGlowSprites = [];
let sunMesh;

// Camera fly animation
let flyAnim = null; // { from, to, fromTarget, toTarget, startTime, duration, onDone }

// Follow target
let followId = null;
let lastFollowPos = new THREE.Vector3();

// Raycasting
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredId = null;

// Loading
let loadProgress = 0;
let onLoadProgress = null;

/* ── Public API ──────────────────────────────────────── */
export function init(canvas, labelContainer, progressCb) {
  onLoadProgress = progressCb;
  setupRenderer(canvas, labelContainer);
  setupScene();
  setupPostProcessing();
  buildBodies();
  buildStarfield();
  buildGalaxy();
  buildNebulae();
  buildBlackHole();
  buildAsteroidBelt();
  setupLighting();
  subscribeToState();
  updateProgress(100);
  return { renderer, scene, camera, controls };
}

export function animate() {
  const delta = Math.min(clock.getDelta(), 0.1); // clamp
  const st = getState();

  if (!st.paused) {
    const dt = delta * st.speed;
    simTime += dt;
    setState({ elapsedDays: st.elapsedDays + dt * 10 }); // ~10 days per second at 1x
  }

  updateBodies(simTime);
  updateSun(simTime);
  updateBlackHole(simTime);
  updateAsteroids(simTime);
  updateTrails();
  updateStarfield(simTime);
  updateCameraFly();
  updateFollow();
  updateHover();

  controls.update();
  composer.render();
  css2dRenderer.render(scene, camera);
}

export function getBodyWorldPos(id) {
  const bm = bodyMeshes[id];
  if (!bm) return new THREE.Vector3();
  const pos = new THREE.Vector3();
  bm.group.getWorldPosition(pos);
  return pos;
}

export function flyToBody(id, onDone) {
  const data = BODY_MAP[id];
  if (!data) return;
  const targetPos = getBodyWorldPos(id);
  const dist = (data.radiusVisual || 5) * 5;
  const offset = new THREE.Vector3(dist * 0.6, dist * 0.4, dist);
  const to = targetPos.clone().add(offset);
  startFly(camera.position.clone(), to, controls.target.clone(), targetPos, CAMERA_FLY_DURATION_MS, () => {
    followId = id;
    lastFollowPos.copy(getBodyWorldPos(id));
    controls.minDistance = (data.radiusVisual || 1) * 2;
    controls.maxDistance = (data.radiusVisual || 1) * 40;
    if (onDone) onDone();
  });
}

export function flyToOverview(onDone) {
  followId = null;
  const to = new THREE.Vector3(0, 120, 220);
  const target = new THREE.Vector3(0, 0, 0);
  startFly(camera.position.clone(), to, controls.target.clone(), target, CAMERA_FLY_DURATION_MS, () => {
    controls.minDistance = 10;
    controls.maxDistance = 800;
    if (onDone) onDone();
  });
}

export function runIntroAnimation(onDone) {
  camera.position.set(0, 50, 600);
  controls.target.set(0, 0, 0);
  const to = new THREE.Vector3(0, 120, 220);
  startFly(camera.position.clone(), to, controls.target.clone(), new THREE.Vector3(0, 0, 0), 4000, onDone);
}

export function handleResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  css2dRenderer.setSize(w, h);
}

export function handleClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = Object.values(bodyMeshes).map(b => b.mesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    const id = hits[0].object.userData.bodyId;
    if (id) {
      setState({ selectedId: id, compareA: id });
    }
  }
}

export function handleMouseMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

export function setSelectionRing(idA, idB) {
  for (const [id, bm] of Object.entries(bodyMeshes)) {
    if (bm.selectionRing) {
      bm.selectionRing.visible = (id === idA || id === idB);
    }
  }
}

/* ── Internal: Setup ─────────────────────────────────── */
function updateProgress(p) {
  loadProgress = p;
  if (onLoadProgress) onLoadProgress(p);
}

function setupRenderer(canvas, labelContainer) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(window.innerWidth, window.innerHeight);
  css2dRenderer.domElement.style.position = 'absolute';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.left = '0';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  labelContainer.appendChild(css2dRenderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(0, 120, 220);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 800;

  clock = new THREE.Clock();
}

function setupScene() {
  scene.background = new THREE.Color(0x000008);
}

function setupPostProcessing() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_PARAMS.strength, BLOOM_PARAMS.radius, BLOOM_PARAMS.threshold
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

function setupLighting() {
  // Sun point light
  const sunLight = new THREE.PointLight(0xFFF5E0, 3.0, 0, 0); // decay 0
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);

  // Very low ambient
  const amb = new THREE.AmbientLight(0x111122, 0.08);
  scene.add(amb);
}

/* ── Internal: Procedural textures ───────────────────── */
function generateTexture(recipe, size = TEX_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  switch (recipe) {
    case 'mercury': drawMercury(ctx, size); break;
    case 'venus': drawVenus(ctx, size); break;
    case 'earth': drawEarth(ctx, size); break;
    case 'moon': drawMoonTex(ctx, size); break;
    case 'mars': drawMars(ctx, size); break;
    case 'jupiter': drawJupiter(ctx, size); break;
    case 'saturn': drawSaturn(ctx, size); break;
    case 'uranus': drawUranus(ctx, size); break;
    case 'neptune': drawNeptune(ctx, size); break;
    case 'pluto': drawPluto(ctx, size); break;
    default: ctx.fillStyle = '#888'; ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noise2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function fbm(x, y, octaves = 5) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2D(x * freq, y * freq);
    amp *= 0.5; freq *= 2;
  }
  return val;
}

function drawMercury(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 8, y / s * 8, 6);
    const crater = noise2D(x * 0.05, y * 0.05) > 0.7 ? -0.15 : 0;
    const v = Math.floor((0.35 + n * 0.3 + crater) * 255);
    ctx.fillStyle = `rgb(${v + 20},${v + 10},${v})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawVenus(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 5 + 1.5, y / s * 5 + 0.3, 5);
    const band = Math.sin(y / s * 20 + n * 5) * 0.15;
    const r = Math.floor((0.85 + n * 0.1 + band) * 255);
    const g = Math.floor((0.75 + n * 0.12 + band) * 255);
    const b = Math.floor((0.55 + n * 0.08) * 255);
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawEarth(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const nx = x / s * 6, ny = y / s * 6;
    const continent = fbm(nx + 2.3, ny + 4.1, 6);
    const isLand = continent > 0.48;
    let r, g, b;
    if (isLand) {
      const elev = (continent - 0.48) * 5;
      r = Math.floor((80 + elev * 80) * (1 + fbm(nx * 2, ny * 2, 3) * 0.3));
      g = Math.floor((120 + elev * 40) * (1 + fbm(nx * 2, ny * 2, 3) * 0.2));
      b = Math.floor(50 + elev * 20);
      // Polar ice
      const lat = Math.abs(y / s - 0.5) * 2;
      if (lat > 0.82) { r = 240; g = 245; b = 255; }
    } else {
      const depth = (0.48 - continent) * 3;
      r = Math.floor(20 + depth * 10);
      g = Math.floor(60 + depth * 30);
      b = Math.floor(160 + depth * 60);
    }
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawMoonTex(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 10, y / s * 10, 5);
    const mare = fbm(x / s * 3 + 7, y / s * 3 + 3, 4) > 0.55 ? -0.12 : 0;
    const v = Math.floor((0.45 + n * 0.2 + mare) * 255);
    ctx.fillStyle = `rgb(${v + 10},${v + 8},${v + 5})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawMars(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 6, y / s * 6, 5);
    const dark = fbm(x / s * 3 + 5, y / s * 3 + 2, 4) > 0.55 ? -0.1 : 0;
    const lat = Math.abs(y / s - 0.5) * 2;
    let r = Math.floor((0.7 + n * 0.2 + dark) * 255);
    let g = Math.floor((0.3 + n * 0.12 + dark) * 200);
    let b = Math.floor((0.15 + n * 0.06) * 150);
    if (lat > 0.85) { r = 230; g = 225; b = 220; } // polar caps
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawJupiter(ctx, s) {
  for (let y = 0; y < s; y++) {
    const bandY = y / s;
    const band = Math.sin(bandY * 40) * 0.5 + 0.5;
    for (let x = 0; x < s; x++) {
      const n = fbm(x / s * 10 + bandY * 2, bandY * 15, 4);
      // Great Red Spot
      const dx = (x / s - 0.35), dy = (bandY - 0.58);
      const spotDist = Math.sqrt(dx * dx * 4 + dy * dy * 16);
      const spot = spotDist < 0.12 ? 0.3 * (1 - spotDist / 0.12) : 0;
      const r = Math.floor((0.65 + band * 0.2 + n * 0.1 + spot) * 255);
      const g = Math.floor((0.45 + band * 0.15 + n * 0.08 + spot * 0.3) * 255);
      const b = Math.floor((0.2 + band * 0.1 + n * 0.05) * 220);
      ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawSaturn(ctx, s) {
  for (let y = 0; y < s; y++) {
    const bandY = y / s;
    const band = Math.sin(bandY * 30) * 0.5 + 0.5;
    for (let x = 0; x < s; x++) {
      const n = fbm(x / s * 8, bandY * 12, 4);
      const r = Math.floor((0.8 + band * 0.12 + n * 0.06) * 255);
      const g = Math.floor((0.7 + band * 0.1 + n * 0.05) * 255);
      const b = Math.floor((0.5 + band * 0.08 + n * 0.04) * 220);
      ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawUranus(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 4, y / s * 4, 4);
    const band = Math.sin(y / s * 20) * 0.05;
    const r = Math.floor((0.4 + n * 0.08 + band) * 200);
    const g = Math.floor((0.72 + n * 0.06 + band) * 255);
    const b = Math.floor((0.74 + n * 0.06) * 255);
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawNeptune(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 5, y / s * 5, 5);
    const band = Math.sin(y / s * 25 + n * 3) * 0.1;
    const r = Math.floor((0.15 + n * 0.06 + band) * 180);
    const g = Math.floor((0.2 + n * 0.08 + band) * 200);
    const b = Math.floor((0.65 + n * 0.15) * 255);
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawPluto(ctx, s) {
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 6, y / s * 6, 5);
    // Heart-shaped light region
    const dx = (x / s - 0.4), dy = (y / s - 0.45);
    const heart = Math.sqrt(dx * dx + dy * dy) < 0.15 ? 0.15 : 0;
    const v = 0.55 + n * 0.2 + heart;
    const r = Math.floor(v * 220);
    const g = Math.floor(v * 195);
    const b = Math.floor(v * 160);
    ctx.fillStyle = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

function generateCloudTexture(s = TEX_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const n = fbm(x / s * 6 + 3.7, y / s * 6 + 1.2, 6);
    const alpha = n > 0.45 ? Math.min((n - 0.45) * 4, 0.85) : 0;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function generateRingTexture(s = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = s; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < s; x++) {
    const t = x / s;
    const band1 = Math.sin(t * 60) * 0.5 + 0.5;
    const band2 = Math.sin(t * 120 + 2) * 0.3 + 0.5;
    const gap = (Math.sin(t * 200) > 0.7) ? 0.1 : 1;
    const alpha = (0.3 + band1 * 0.4 + band2 * 0.2) * gap;
    const bright = 0.7 + band1 * 0.3;
    const r = Math.floor(bright * 230);
    const g = Math.floor(bright * 210);
    const b = Math.floor(bright * 170);
    for (let y = 0; y < 64; y++) {
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function generateGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(255,255,200,1)');
  grad.addColorStop(0.15, 'rgba(255,200,80,0.6)');
  grad.addColorStop(0.4, 'rgba(255,120,20,0.2)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clamp(v) { return Math.max(0, Math.min(255, Math.floor(v))); }

/* ── Internal: Build bodies ──────────────────────────── */
function buildBodies() {
  updateProgress(10);
  const planetBodies = BODIES.filter(b => b.id !== 'blackhole');

  planetBodies.forEach((data, i) => {
    const group = new THREE.Group();
    group.userData.bodyId = data.id;

    let mesh;
    if (data.id === 'sun') {
      mesh = buildSun(group, data);
    } else {
      mesh = buildPlanet(group, data);
    }

    // Orbit line (not for sun or moon)
    let orbitLine = null;
    if (data.distanceVisual > 0 && !data.parent) {
      orbitLine = buildOrbitLine(data.distanceVisual);
      scene.add(orbitLine);
    }

    // Moon orbit around parent
    if (data.parent) {
      orbitLine = buildOrbitLine(data.distanceVisual, 0.3);
    }

    // Trail
    let trail = null;
    if (data.distanceVisual > 0 && data.id !== 'moon') {
      trail = buildTrail(data);
      scene.add(trail);
    }

    // CSS2D Label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'body-label';
    labelDiv.textContent = data.name;
    labelDiv.style.pointerEvents = 'auto';
    labelDiv.style.cursor = 'pointer';
    labelDiv.addEventListener('click', () => {
      setState({ selectedId: data.id, compareA: data.id });
    });
    const label = new CSS2DObject(labelDiv);
    label.position.y = data.radiusVisual * 1.5 + 1;
    group.add(label);

    // Selection ring
    const ringGeo = new THREE.RingGeometry(data.radiusVisual * 1.6, data.radiusVisual * 1.8, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00FFFF, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false
    });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;
    group.add(selectionRing);

    // Position in scene
    if (!data.parent) {
      scene.add(group);
    } else {
      // Moon: add to parent's group
      const parentEntry = bodyMeshes[data.parent];
      if (parentEntry) {
        parentEntry.group.add(group);
        if (orbitLine) parentEntry.group.add(orbitLine);
      }
    }

    bodyMeshes[data.id] = {
      group, mesh, orbit: orbitLine, trail, label, selectionRing,
      cloudMesh: group.userData.cloudMesh || null,
      atmosphereMesh: group.userData.atmosphereMesh || null,
      ringMesh: group.userData.ringMesh || null,
      trailPositions: [],
      data
    };

    updateProgress(10 + (i / planetBodies.length) * 50);
  });
}

function buildSun(group, data) {
  // Sun shader material
  const sunGeo = new THREE.SphereGeometry(data.radiusVisual, 64, 64);
  const sunMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(0xFDB813) },
      uColor2: { value: new THREE.Color(0xFF4500) },
      uColor3: { value: new THREE.Color(0xFFFFCC) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vUv = uv;
        vNormal = normal;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec3 uColor3;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;

      // Simple hash-based noise
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) {
          v += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        // Rotate UV slowly
        float angle = uTime * 0.05;
        vec2 center = vec2(0.5);
        uv -= center;
        uv = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;
        uv += center;

        float n1 = fbm(uv * 8.0 + uTime * 0.15);
        float n2 = fbm(uv * 12.0 - uTime * 0.1 + 5.0);
        float turb = fbm(uv * 16.0 + vec2(n1, n2) * 2.0 + uTime * 0.08);

        // Granulation
        float gran = noise(uv * 40.0 + uTime * 0.2) * 0.15;

        float intensity = n1 * 0.4 + n2 * 0.3 + turb * 0.3 + gran;

        vec3 col = mix(uColor2, uColor1, intensity);
        col = mix(col, uColor3, pow(intensity, 3.0) * 0.8);

        // Edge darkening (limb darkening)
        float fresnel = 1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0));
        col *= (1.0 - fresnel * 0.3);

        // Bright spots
        float spots = pow(turb, 4.0) * 2.0;
        col += spots * uColor3;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.FrontSide
  });

  const mesh = new THREE.Mesh(sunGeo, sunMat);
  mesh.userData.bodyId = data.id;
  group.add(mesh);
  sunMesh = mesh;

  // Glow sprites (layered additive)
  const glowTex = generateGlowTexture(256);
  const glowSizes = [40, 60, 90];
  const glowOpacities = [0.4, 0.2, 0.1];
  const glowColors = [0xFFCC44, 0xFF8800, 0xFF4400];

  glowSizes.forEach((size, i) => {
    const spriteMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: glowColors[i],
      transparent: true,
      opacity: glowOpacities[i],
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(size, size, 1);
    group.add(sprite);
    sunGlowSprites.push(sprite);
  });

  // Corona ring
  const coronaGeo = new THREE.RingGeometry(data.radiusVisual * 1.1, data.radiusVisual * 2.5, 64);
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }
      void main() {
        float dist = length(vUv - 0.5) * 2.0;
        float n = noise(vUv * 8.0 + uTime * 0.3);
        float alpha = (1.0 - dist) * 0.4 * (0.6 + n * 0.4);
        alpha *= smoothstep(1.0, 0.2, dist);
        vec3 col = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.9, 0.3), n);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const corona = new THREE.Mesh(coronaGeo, coronaMat);
  corona.lookAt(camera.position);
  corona.userData.isBillboard = true;
  group.add(corona);
  group.userData.corona = corona;

  return mesh;
}

function buildPlanet(group, data) {
  const geo = new THREE.SphereGeometry(data.radiusVisual, 48, 48);
  const tex = generateTexture(data.textureRecipe);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.85,
    metalness: 0.05
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.bodyId = data.id;

  // Axial tilt
  const tiltRad = (data.tilt || 0) * Math.PI / 180;
  mesh.rotation.z = tiltRad;
  group.add(mesh);

  // Cloud layer (Earth)
  if (data.cloudLayer) {
    const cloudGeo = new THREE.SphereGeometry(data.radiusVisual * 1.02, 48, 48);
    const cloudTex = generateCloudTexture();
    const cloudMat = new THREE.MeshStandardMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.rotation.z = tiltRad;
    group.add(cloudMesh);
    group.userData.cloudMesh = cloudMesh;
  }

  // Atmosphere glow (fresnel)
  if (data.atmosphere) {
    const atmosGeo = new THREE.SphereGeometry(data.radiusVisual * 1.06, 48, 48);
    const atmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(data.atmosphere.color) },
        uOpacity: { value: data.atmosphere.opacity }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - dot(vNormal, viewDir);
          fresnel = pow(fresnel, 3.0);
          gl_FragColor = vec4(uColor, fresnel * uOpacity * 2.5);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    group.add(atmosMesh);
    group.userData.atmosphereMesh = atmosMesh;
  }

  // Rings (Saturn, Uranus)
  if (data.ring) {
    const ringGeo = new THREE.RingGeometry(
      data.radiusVisual * data.ring.innerRadius,
      data.radiusVisual * data.ring.outerRadius,
      128
    );
    // Fix UVs for radial gradient
    const pos = ringGeo.attributes.position;
    const uv = ringGeo.attributes.uv;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      const len = v3.length();
      const innerR = data.radiusVisual * data.ring.innerRadius;
      const outerR = data.radiusVisual * data.ring.outerRadius;
      uv.setXY(i, (len - innerR) / (outerR - innerR), 0.5);
    }

    const ringTex = generateRingTexture();
    const ringMat = new THREE.MeshStandardMaterial({
      map: ringTex,
      transparent: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1,
      depthWrite: false
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    // Apply same tilt
    const ringPivot = new THREE.Group();
    ringPivot.rotation.z = tiltRad;
    ringPivot.add(ringMesh);
    group.add(ringPivot);
    group.userData.ringMesh = ringMesh;
  }

  return mesh;
}

function buildOrbitLine(distance, opacity = 0.2) {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * distance, 0, Math.sin(a) * distance));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0x4488AA,
    transparent: true,
    opacity: opacity,
    depthWrite: false
  });
  return new THREE.Line(geo, mat);
}

function buildTrail(data) {
  const positions = new Float32Array(TRAIL_LENGTH * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(data.colorPrimary),
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });
  return new THREE.Line(geo, mat);
}

/* ── Internal: Starfield ─────────────────────────────── */
function buildStarfield() {
  const quality = getState().qualityHigh;
  const counts = quality ? STAR_COUNT : STAR_COUNT.map(c => Math.floor(c / 3));
  const depths = [800, 1200, 1800];

  starLayers = depths.map((depth, li) => {
    const count = counts[li];
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Distribute on a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = depth + (Math.random() - 0.5) * 200;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      // Color variation
      const temp = Math.random();
      colors[i * 3] = 0.8 + temp * 0.2;
      colors[i * 3 + 1] = 0.8 + temp * 0.15;
      colors[i * 3 + 2] = 0.9 + temp * 0.1;
      sizes[i] = 0.5 + Math.random() * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: 1.2 - li * 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: false
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return points;
  });
  updateProgress(65);
}

/* ── Internal: Galaxy backdrop ───────────────────────── */
function buildGalaxy() {
  const count = 15000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const arms = 4;
  for (let i = 0; i < count; i++) {
    const arm = i % arms;
    const t = Math.random();
    const dist = t * 600 + 300;
    const armAngle = (arm / arms) * Math.PI * 2;
    const spiralAngle = t * Math.PI * 3;
    const angle = armAngle + spiralAngle;
    const spread = (1 - t * 0.5) * 40;
    const x = Math.cos(angle) * dist + (Math.random() - 0.5) * spread;
    const y = (Math.random() - 0.5) * 15 * (1 - t);
    const z = Math.sin(angle) * dist + (Math.random() - 0.5) * spread;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y - 200;
    positions[i * 3 + 2] = z - 500;
    // Color: inner warm, outer cool
    const warmth = 1 - t;
    colors[i * 3] = 0.4 + warmth * 0.5;
    colors[i * 3 + 1] = 0.3 + warmth * 0.3;
    colors[i * 3 + 2] = 0.6 + (1 - warmth) * 0.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending
  });
  galaxyPoints = new THREE.Points(geo, mat);
  scene.add(galaxyPoints);
  updateProgress(72);
}

/* ── Internal: Nebulae ───────────────────────────────── */
function buildNebulae() {
  const nebulaColors = [0x4422AA, 0x2244AA, 0xAA2266, 0x226688];
  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = 64;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    const color = new THREE.Color(nebulaColors[i % nebulaColors.length]);
    grad.addColorStop(0, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.25)`);
    grad.addColorStop(0.5, `rgba(${Math.floor(color.r * 255)},${Math.floor(color.g * 255)},${Math.floor(color.b * 255)},0.08)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.6
    });
    const sprite = new THREE.Sprite(mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = 500 + Math.random() * 500;
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta) - 100,
      r * Math.cos(phi)
    );
    sprite.scale.set(200 + Math.random() * 300, 200 + Math.random() * 300, 1);
    scene.add(sprite);
    nebulaSprites.push(sprite);
  }
  updateProgress(75);
}

/* ── Internal: Black hole ────────────────────────────── */
function buildBlackHole() {
  const bhData = BODY_MAP['blackhole'];
  const group = new THREE.Group();
  group.position.set(bhData.distanceVisual, 30, -100);
  group.userData.bodyId = 'blackhole';

  // Event horizon (black sphere)
  const ehGeo = new THREE.SphereGeometry(bhData.radiusVisual, 32, 32);
  const ehMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const ehMesh = new THREE.Mesh(ehGeo, ehMat);
  ehMesh.userData.bodyId = 'blackhole';
  group.add(ehMesh);

  // Photon ring
  const prGeo = new THREE.TorusGeometry(bhData.radiusVisual * 1.3, 0.3, 16, 64);
  const prMat = new THREE.MeshBasicMaterial({
    color: 0xFFCC44,
    transparent: true,
    opacity: 0.8
  });
  const prMesh = new THREE.Mesh(prGeo, prMat);
  prMesh.rotation.x = Math.PI / 2;
  group.add(prMesh);

  // Accretion disk
  const diskGeo = new THREE.RingGeometry(bhData.radiusVisual * 1.5, bhData.radiusVisual * 4, 128);
  const diskMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vPos;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }
      void main() {
        float angle = atan(vPos.z, vPos.x) + uTime * 0.5;
        float dist = length(vPos.xz);
        float n = noise(vec2(angle * 3.0, dist * 0.5) + uTime * 0.2);
        // One side brighter (doppler beaming)
        float doppler = 0.6 + 0.4 * sin(angle - uTime * 0.3);
        float intensity = (0.5 + n * 0.5) * doppler;
        vec3 innerColor = vec3(1.0, 0.8, 0.3);
        vec3 outerColor = vec3(0.8, 0.2, 0.05);
        float t = (dist - 9.0) / 15.0;
        vec3 col = mix(innerColor, outerColor, clamp(t, 0.0, 1.0)) * intensity;
        float alpha = (1.0 - t * 0.7) * intensity * 0.9;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.rotation.x = -Math.PI * 0.4; // Tilted disk
  group.add(diskMesh);

  // Glow
  const glowTex = generateGlowTexture(128);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xFF6600,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(40, 40, 1);
  group.add(glowSprite);

  scene.add(group);
  blackHoleGroup = group;

  // CSS2D Label
  const labelDiv = document.createElement('div');
  labelDiv.className = 'body-label';
  labelDiv.textContent = 'Black Hole';
  labelDiv.style.pointerEvents = 'auto';
  labelDiv.style.cursor = 'pointer';
  labelDiv.addEventListener('click', () => {
    setState({ selectedId: 'blackhole', compareA: 'blackhole' });
  });
  const label = new CSS2DObject(labelDiv);
  label.position.y = bhData.radiusVisual * 2;
  group.add(label);

  // Selection ring
  const selRingGeo = new THREE.RingGeometry(bhData.radiusVisual * 1.6, bhData.radiusVisual * 1.8, 64);
  const selRingMat = new THREE.MeshBasicMaterial({
    color: 0x00FFFF, transparent: true, opacity: 0.6,
    side: THREE.DoubleSide, depthWrite: false
  });
  const selRing = new THREE.Mesh(selRingGeo, selRingMat);
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  group.add(selRing);

  bodyMeshes['blackhole'] = {
    group, mesh: ehMesh, orbit: null, trail: null, label,
    selectionRing: selRing,
    cloudMesh: null, atmosphereMesh: null, ringMesh: null,
    trailPositions: [],
    data: bhData,
    diskMat
  };
  updateProgress(80);
}

/* ── Internal: Asteroid belt ─────────────────────────── */
function buildAsteroidBelt() {
  const quality = getState().qualityHigh;
  const count = quality ? ASTEROID_COUNT_HIGH : ASTEROID_COUNT_LOW;
  const geo = new THREE.IcosahedronGeometry(0.2, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x888877,
    roughness: 0.9,
    metalness: 0.1
  });
  asteroidMesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const inner = 88, outer = 105; // between Mars and Jupiter visual distances

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = inner + Math.random() * (outer - inner);
    const y = (Math.random() - 0.5) * 3;
    dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    dummy.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const s = 0.3 + Math.random() * 1.5;
    dummy.scale.set(s, s * (0.5 + Math.random()), s);
    dummy.updateMatrix();
    asteroidMesh.setMatrixAt(i, dummy.matrix);
  }
  asteroidMesh.instanceMatrix.needsUpdate = true;
  asteroidGroup = new THREE.Group();
  asteroidGroup.add(asteroidMesh);
  scene.add(asteroidGroup);
  updateProgress(90);
}

/* ── Internal: Update loops ──────────────────────────── */
function updateBodies(t) {
  const st = getState();
  for (const [id, bm] of Object.entries(bodyMeshes)) {
    const data = bm.data;
    if (!data || id === 'blackhole') continue;

    // Orbital motion: use sqrt of real orbital period for visual speed compression
    if (data.distanceVisual > 0 && !data.parent) {
      const realPeriod = data.orbitalPeriodDays || 365;
      const visualPeriod = Math.sqrt(realPeriod) * 2; // compressed
      const angularSpeed = (Math.PI * 2) / visualPeriod;
      const angle = t * angularSpeed;
      bm.group.position.x = Math.cos(angle) * data.distanceVisual;
      bm.group.position.z = Math.sin(angle) * data.distanceVisual;
    }

    // Moon orbit
    if (data.parent) {
      const realPeriod = data.orbitalPeriodDays || 27;
      const angularSpeed = (Math.PI * 2) / (Math.sqrt(realPeriod) * 1.5);
      const angle = t * angularSpeed;
      bm.group.position.x = Math.cos(angle) * data.distanceVisual;
      bm.group.position.z = Math.sin(angle) * data.distanceVisual;
    }

    // Self rotation
    if (bm.mesh && data.id !== 'sun') {
      bm.mesh.rotation.y = t * 0.5 * (data.rotationHours > 0 ? 1 : -1);
    }

    // Cloud rotation (Earth)
    if (bm.cloudMesh || bm.group.userData.cloudMesh) {
      const cm = bm.cloudMesh || bm.group.userData.cloudMesh;
      cm.rotation.y = t * 0.6;
    }

    // Label visibility
    if (bm.label) {
      bm.label.visible = st.showLabels;
    }
  }
}

function updateSun(t) {
  if (sunMesh && sunMesh.material.uniforms) {
    sunMesh.material.uniforms.uTime.value = t;
    sunMesh.rotation.y = t * 0.02;
  }

  // Pulse glow
  sunGlowSprites.forEach((s, i) => {
    const pulse = 1 + Math.sin(t * 0.5 + i * 1.5) * 0.08;
    const baseSize = [40, 60, 90][i];
    s.scale.set(baseSize * pulse, baseSize * pulse, 1);
  });

  // Corona billboard
  const entry = bodyMeshes['sun'];
  if (entry && entry.group.userData.corona) {
    entry.group.userData.corona.lookAt(camera.position);
    if (entry.group.userData.corona.material.uniforms) {
      entry.group.userData.corona.material.uniforms.uTime.value = t;
    }
  }
}

function updateBlackHole(t) {
  if (!blackHoleGroup) return;
  blackHoleGroup.rotation.y = t * 0.03;
  const bhEntry = bodyMeshes['blackhole'];
  if (bhEntry && bhEntry.diskMat && bhEntry.diskMat.uniforms) {
    bhEntry.diskMat.uniforms.uTime.value = t;
  }
}

function updateAsteroids(t) {
  if (asteroidGroup) {
    asteroidGroup.rotation.y = t * 0.008;
  }
}

function updateTrails() {
  const st = getState();
  for (const [id, bm] of Object.entries(bodyMeshes)) {
    if (!bm.trail) continue;
    bm.trail.visible = st.showTrails;
    if (st.paused) continue;
    const pos = new THREE.Vector3();
    bm.group.getWorldPosition(pos);
    bm.trailPositions.push(pos.x, pos.y, pos.z);
    if (bm.trailPositions.length > TRAIL_LENGTH * 3) {
      bm.trailPositions.splice(0, 3);
    }
    const arr = bm.trail.geometry.attributes.position.array;
    const len = bm.trailPositions.length;
    for (let i = 0; i < len; i++) arr[i] = bm.trailPositions[i];
    bm.trail.geometry.attributes.position.needsUpdate = true;
    bm.trail.geometry.setDrawRange(0, len / 3);
  }
}

function updateStarfield(t) {
  // Gentle parallax rotation to simulate travel
  starLayers.forEach((layer, i) => {
    layer.rotation.y = t * 0.001 * (i + 1) * 0.5;
    layer.rotation.x = t * 0.0003 * (i + 1);
  });
  if (galaxyPoints) {
    galaxyPoints.rotation.y = t * 0.002;
  }
}

/* ── Internal: Camera ────────────────────────────────── */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function startFly(from, to, fromTarget, toTarget, duration, onDone) {
  followId = null;
  flyAnim = { from: from.clone(), to: to.clone(), fromTarget: fromTarget.clone(), toTarget: toTarget.clone(), startTime: performance.now(), duration, onDone };
}

function updateCameraFly() {
  if (!flyAnim) return;
  const elapsed = performance.now() - flyAnim.startTime;
  let t = Math.min(elapsed / flyAnim.duration, 1);
  t = easeInOutCubic(t);
  camera.position.lerpVectors(flyAnim.from, flyAnim.to, t);
  controls.target.lerpVectors(flyAnim.fromTarget, flyAnim.toTarget, t);
  if (t >= 1) {
    const done = flyAnim.onDone;
    flyAnim = null;
    if (done) done();
  }
}

function updateFollow() {
  if (!followId) return;
  const pos = getBodyWorldPos(followId);
  const delta = pos.clone().sub(lastFollowPos);
  camera.position.add(delta);
  controls.target.add(delta);
  lastFollowPos.copy(pos);
}

/* ── Internal: Hover / Raycast ───────────────────────── */
function updateHover() {
  raycaster.setFromCamera(mouse, camera);
  const meshes = Object.values(bodyMeshes).map(b => b.mesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  const canvas = renderer.domElement;
  if (hits.length > 0) {
    const id = hits[0].object.userData.bodyId;
    if (id !== hoveredId) {
      hoveredId = id;
      canvas.style.cursor = 'pointer';
      // Show tooltip
      const tooltipEl = document.getElementById('hover-tooltip');
      if (tooltipEl) {
        tooltipEl.textContent = BODY_MAP[id]?.name || '';
        tooltipEl.style.display = 'block';
      }
    }
    // Position tooltip near mouse
    const tooltipEl = document.getElementById('hover-tooltip');
    if (tooltipEl && hoveredId) {
      const rect = canvas.getBoundingClientRect();
      const mx = ((mouse.x + 1) / 2) * rect.width + rect.left;
      const my = ((-mouse.y + 1) / 2) * rect.height + rect.top;
      tooltipEl.style.left = mx + 15 + 'px';
      tooltipEl.style.top = my - 10 + 'px';
    }
  } else {
    if (hoveredId) {
      hoveredId = null;
      canvas.style.cursor = 'default';
      const tooltipEl = document.getElementById('hover-tooltip');
      if (tooltipEl) tooltipEl.style.display = 'none';
    }
  }
}

/* ── Internal: State subscriber ──────────────────────── */
function subscribeToState() {
  subscribe((st, changed) => {
    if (changed.includes('showOrbits')) {
      for (const bm of Object.values(bodyMeshes)) {
        if (bm.orbit) bm.orbit.visible = st.showOrbits;
      }
    }
    if (changed.includes('showAsteroids')) {
      if (asteroidGroup) asteroidGroup.visible = st.showAsteroids;
    }
    if (changed.includes('qualityHigh')) {
      if (bloomPass) {
        bloomPass.enabled = st.qualityHigh;
      }
    }
    if (changed.includes('selectedId')) {
      // Fly to body
      if (st.selectedId) {
        flyToBody(st.selectedId);
      }
    }
  });
}
