// Minimal dependency-free software renderer for the layered-composition demo.
// Rasterizes the composed column (usd::usdgeom::mesh + bsi::ifc::presentation::diffuseColor)
// to a PNG using only Node built-ins (zlib). No browser / WebGL / three.js needed.
//
// Usage: node render-still.mjs <composed.json> <out.png>
//
// It exists to verify the geometry headlessly (back-face culling proves the winding
// is outward) and to produce before/after stills for the demo.

import fs from "node:fs";
import zlib from "node:zlib";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: node render-still.mjs <composed.json> <out.png>"); process.exit(1); }

// --- find the first mesh node in a composed ifcx tree -------------------------
function findMesh(node) {
  const a = node.attributes || {};
  if (a["usd::usdgeom::mesh"]) return node;
  for (const c of Object.values(node.children || {})) { const f = findMesh(c); if (f) return f; }
  return null;
}
const tree = JSON.parse(fs.readFileSync(inPath, "utf8"));
const node = findMesh(tree);
if (!node) { console.error("no mesh found in", inPath); process.exit(1); }
const mesh = node.attributes["usd::usdgeom::mesh"];
const verts = mesh.points;                       // [[x,y,z], ...]
const idx = mesh.faceVertexIndices;              // [i0,i1,i2, ...]
const col = node.attributes["bsi::ifc::presentation::diffuseColor"] || [0.6, 0.6, 0.6];

// --- tiny vec3 ----------------------------------------------------------------
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

// --- camera (z-up, matches the viewer) ---------------------------------------
const W = 720, H = 960, aspect = W / H;
const C = [3.4, 3.0, 3.4], T = [0, 0, 1.45], UP = [0, 0, 1];
const fwd = norm(sub(T, C)), right = norm(cross(fwd, UP)), up = cross(right, fwd);
const tanHalf = Math.tan((38 * Math.PI / 180) / 2);
const light = norm([0.55, 0.45, 0.8]); // from upper-front so camera-facing sides are lit

function project(p) {
  const r = sub(p, C);
  const x = dot(r, right), y = dot(r, up), z = dot(r, fwd); // z = depth (forward)
  if (z <= 0.01) return null;
  const sx = (x / (z * tanHalf * aspect)), sy = (y / (z * tanHalf));
  return { px: (sx * 0.5 + 0.5) * W, py: (0.5 - sy * 0.5) * H, z };
}

// --- framebuffer + z-buffer (gradient sky background) ------------------------
const fb = new Uint8Array(W * H * 3), zb = new Float32Array(W * H).fill(Infinity);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const t = y / H, o = (y * W + x) * 3;
  fb[o] = 232 - t*40; fb[o+1] = 238 - t*36; fb[o+2] = 245 - t*22;
}

function tri(a, b, c, rgb) {
  const minX = Math.max(0, Math.floor(Math.min(a.px, b.px, c.px)));
  const maxX = Math.min(W-1, Math.ceil(Math.max(a.px, b.px, c.px)));
  const minY = Math.max(0, Math.floor(Math.min(a.py, b.py, c.py)));
  const maxY = Math.min(H-1, Math.ceil(Math.max(a.py, b.py, c.py)));
  const area = (b.px-a.px)*(c.py-a.py) - (b.py-a.py)*(c.px-a.px);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    let w0 = ((b.px-px)*(c.py-py) - (b.py-py)*(c.px-px)) / area;
    let w1 = ((c.px-px)*(a.py-py) - (c.py-py)*(a.px-px)) / area;
    let w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0*a.z + w1*b.z + w2*c.z, i = y*W + x;
    if (z >= zb[i]) continue;
    zb[i] = z;
    const o = i*3;
    fb[o] = rgb[0]; fb[o+1] = rgb[1]; fb[o+2] = rgb[2];
  }
}

// --- draw, with back-face culling (outward winding => visible) ----------------
let drawn = 0, culled = 0;
for (let t = 0; t < idx.length; t += 3) {
  const A = verts[idx[t]], B = verts[idx[t+1]], Cc = verts[idx[t+2]];
  const n = norm(cross(sub(B, A), sub(Cc, A)));
  const center = [(A[0]+B[0]+Cc[0])/3, (A[1]+B[1]+Cc[1])/3, (A[2]+B[2]+Cc[2])/3];
  if (dot(n, norm(sub(C, center))) <= 0) { culled++; continue; } // facing away
  const pa = project(A), pb = project(B), pc = project(Cc);
  if (!pa || !pb || !pc) continue;
  const shade = 0.35 + 0.65 * Math.max(0, dot(n, light));
  tri(pa, pb, pc, [col[0]*255*shade, col[1]*255*shade, col[2]*255*shade].map(v => Math.min(255, v|0)));
  drawn++;
}

// --- PNG encode (truecolor, filter 0) ----------------------------------------
function png(buf, w, h) {
  const raw = Buffer.alloc((w*3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y*(w*3+1)] = 0; buf.copy(raw, y*(w*3+1)+1, y*w*3, y*w*3 + w*3); }
  const idat = zlib.deflateSync(raw);
  const crcTab = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const v of b) c = crcTab[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

fs.writeFileSync(outPath, png(Buffer.from(fb), W, H));
console.log(`rendered ${outPath}  (faces drawn=${drawn} culled=${culled}, color=[${col}])`);
