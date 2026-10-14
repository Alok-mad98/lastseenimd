// The title-screen world: a low-poly house at night, drawn the way a PS1 would draw it.
// Low internal resolution, flat shading, vertices snapped to a coarse grid, heavy fog. No model files: everything is built from boxes and cones.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const canvas = document.getElementById("scene");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const W = 384, H = 216; // rendered small, stretched by CSS with image-rendering: pixelated
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
renderer.setSize(W, H, false);
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);
scene.fog = new THREE.Fog(0x070a10, 14, 60);
const cam = new THREE.PerspectiveCamera(58, W / H, 0.1, 120);

// PS1 wobble: snap every projected vertex to a coarse screen grid
const snap = m => {
  m.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n gl_Position.xy = floor(gl_Position.xy / gl_Position.w * vec2(96.0, 54.0) + 0.5) / vec2(96.0, 54.0) * gl_Position.w;");
  };
  return m;
};
const mat = (c, e = 0) => snap(new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: e ? c : 0x000000, emissiveIntensity: e }));
const box = (w, h, d, c, x, y, z, e) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, e)); m.position.set(x, y, z); scene.add(m); return m; };

scene.add(new THREE.AmbientLight(0x4a5f85, 2.6));
const moon = new THREE.DirectionalLight(0x8fa6d0, 1.6); moon.position.set(-6, 10, 4); scene.add(moon);

// ground and road
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160, 24, 24), mat(0x1a2a1f)); ground.rotation.x = -Math.PI / 2; scene.add(ground);
box(5, 0.04, 120, 0x15171a, 0, 0.02, -20);
for (let i = 0; i < 16; i++) box(0.18, 0.05, 1.6, 0x5a583e, 0, 0.05, 12 - i * 6);

// the house
box(7, 3.4, 5.5, 0x6a5d4c, 7.5, 1.7, -14);
const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.6, 4), mat(0x1c1a1c)); roof.position.set(7.5, 4.7, -14); roof.rotation.y = Math.PI / 4; scene.add(roof);
box(1.2, 2.1, 0.1, 0x16110d, 6.4, 1.05, -11.2);
const win = box(1.3, 1.1, 0.1, 0xe9c768, 9.2, 2.0, -11.2, 1.3);
box(1.3, 1.1, 0.1, 0x0a0c10, 4.7, 2.0, -11.2);
const winLight = new THREE.PointLight(0xe9c768, 40, 14, 2); winLight.position.set(9.2, 2, -10.4); scene.add(winLight);

// street lamp
box(0.14, 5, 0.14, 0x22262b, -3.2, 2.5, -6);
box(1.2, 0.1, 0.14, 0x22262b, -2.7, 5, -6);
const bulb = box(0.4, 0.14, 0.3, 0xffe3a0, -2.2, 4.92, -6, 2);
const lamp = new THREE.PointLight(0xffd98a, 70, 22, 2); lamp.position.set(-2.2, 4.6, -6); scene.add(lamp);

// trees
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 90; i++) {
  const side = rnd() < 0.5 ? -1 : 1, x = side * (5 + rnd() * 30), z = 14 - rnd() * 70;
  if (x > 2 && x < 13 && z < -9 && z > -19) continue;
  const h = 3 + rnd() * 4.5;
  const t = new THREE.Mesh(new THREE.ConeGeometry(1 + rnd() * 0.9, h, 5), mat(0x17301f)); t.position.set(x, h / 2 + 0.7, z); scene.add(t);
  box(0.26, 1.4, 0.26, 0x1a130d, x, 0.7, z);
}

// someone standing at the treeline. Sometimes.
// A man in a hooded jacket, about 1.8 m, head slightly down: the same low-poly person as the Blender shots in the launch film.
// Six-sided limbs, flat shading, no textures. These games frighten with ordinary people, so he is built like one.
const figure = new THREE.Group();
const M = { hoodie: mat(0x2a2e38), jeans: mat(0x1c2740), skin: mat(0x8a6a55), shoe: mat(0x111214), eye: mat(0x050505) };
const part = (geo, m, x, y, z, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, M[m]); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.scale.set(sx, sy, sz); figure.add(o); return o; };
const tube = (rTop, rBottom, h, sides = 6) => new THREE.CylinderGeometry(rTop, rBottom, h, sides);
const cube = (w, h, d) => new THREE.BoxGeometry(w, h, d);
for (const s of [-1, 1]) {
  part(cube(0.11, 0.09, 0.27), "shoe", s * 0.10, 0.045, 0.04);
  part(tube(0.075, 0.062, 0.46), "jeans", s * 0.10, 0.32, 0);
  part(tube(0.098, 0.078, 0.46), "jeans", s * 0.10, 0.78, 0);
  part(tube(0.068, 0.058, 0.34), "hoodie", s * 0.265, 1.33, 0, 0, s * 0.10);
  part(tube(0.058, 0.048, 0.30), "hoodie", s * 0.295, 1.03, 0.02, -0.12, s * 0.04);
  part(cube(0.07, 0.11, 0.05), "skin", s * 0.30, 0.83, 0.04);
  part(cube(0.028, 0.016, 0.02), "eye", s * 0.042, 1.80, 0.137);
}
part(cube(0.34, 0.20, 0.20), "jeans", 0, 1.02, 0);
part(tube(0.20, 0.19, 0.30, 8), "hoodie", 0, 1.20, 0, 0, 0, 1, 1, 0.62);
part(tube(0.235, 0.20, 0.34, 8), "hoodie", 0, 1.46, 0, 0, 0, 1, 1, 0.6);
part(cube(0.52, 0.09, 0.19), "hoodie", 0, 1.60, 0);
part(tube(0.05, 0.055, 0.08), "skin", 0, 1.67, 0.01);
part(new THREE.IcosahedronGeometry(0.5, 1), "skin", 0, 1.80, 0.035, 0.22, 0, 0.19, 0.25, 0.21);
part(new THREE.IcosahedronGeometry(0.5, 1), "hoodie", 0, 1.815, -0.045, 0, 0, 0.26, 0.30, 0.26);
part(cube(0.24, 0.05, 0.10), "hoodie", 0, 1.935, 0.09);
figure.position.set(3.4, 0, -8.5); figure.rotation.y = -0.25; // at the edge of the road, turned towards you
scene.add(figure);

// rain
const N = 500, pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 40; pos[i * 3 + 1] = rnd() * 16; pos[i * 3 + 2] = 8 - rnd() * 40; }
const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x8fa3b8, size: 0.07, transparent: true, opacity: 0.55 })); scene.add(rain);

const ALWAYS = new URLSearchParams(location.search).has("figure"); // ?figure keeps him in view, for checking the model
let mx = 0, my = 0, walk = 0, walkTo = 0;
// the title screen can ask the camera to walk up to the front door, and to step back again
window.SCENE = { approach() { walkTo = 1; }, retreat() { walkTo = 0; } };
addEventListener("pointermove", e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

function frame(ms) {
  const t = ms / 1000;
  // slow handheld sway, the camera is someone standing in the road
  walk += (walkTo - walk) * 0.035;
  const bob = Math.abs(walkTo - walk) > 0.02 ? Math.sin(t * 9) * 0.05 : 0; // footsteps while moving
  cam.position.set(-0.6 + walk * 6.6 + Math.sin(t * 0.21) * 0.35 * (1 - walk) + mx * 0.8, 1.72 + Math.sin(t * 1.3) * 0.02 + bob, 7.5 - walk * 15.5 + Math.sin(t * 0.13) * 0.5 * (1 - walk));
  cam.lookAt(2.4 + walk * 4 + mx * 2.5, 1.9 - walk * 0.6 - my * 1.2, -12);
  // the lamp is failing
  const f = Math.sin(t * 31) * Math.sin(t * 7.3) > 0.86 ? 0.15 : 1;
  lamp.intensity = 70 * f; bulb.material.emissiveIntensity = 2 * f;
  winLight.intensity = 40 + Math.sin(t * 2.1) * 3;
  // the figure is there for a few seconds out of every forty
  figure.visible = ALWAYS || ((t % 40) > 29 && (t % 40) < 34);
  const p = rg.attributes.position.array;
  for (let i = 1; i < p.length; i += 3) { p[i] -= 0.33; if (p[i] < 0) p[i] = 16; }
  rg.attributes.position.needsUpdate = true;
  renderer.render(scene, cam);
  if (!reduce) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
