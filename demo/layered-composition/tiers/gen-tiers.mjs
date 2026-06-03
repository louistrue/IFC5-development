// Generates the three geometry TIERS for the demo column, each a composable layer
// that overrides `usd::usdgeom::mesh` on the same column path:
//
//   tier-P (Profile)  : the 2D steel cross-section, as a closed basiscurves polyline
//   tier-B (Boundary) : a coarse extruded box  (the architect's massing volume)
//   tier-M (Mesh)     : the full extruded I-section  (the structural steel profile)
//
// Run: node gen-tiers.mjs   (writes tier-{P,B,M}.ifcx next to this file)
//
// Fidelity is itself an opinion: load ONE tier alongside the discipline layers and
// it wins over the architect's box. Mirrors LTplus-AG/IFCX@louistrue-geometry-tiers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const COL = "2a3b1c00-0000-4000-8000-000000000c01";
const Hz = 3.0;                                  // column height (extrude along z)

// --- steel I-section profile (centred, in x-y) -------------------------------
const hx = 0.10, hy = 0.10, tf = 0.03, hw = 0.012;
const P = [
  [-hx, -hy], [hx, -hy], [hx, -hy+tf], [hw, -hy+tf], [hw, hy-tf], [hx, hy-tf],
  [hx, hy], [-hx, hy], [-hx, hy-tf], [-hw, hy-tf], [-hw, -hy+tf], [-hx, -hy+tf],
];

// --- extrude a closed profile into a solid mesh ------------------------------
/**
 * Extrude a closed 2D profile along +z into a solid triangle mesh.
 * @param {number[][]} profile - profile vertices as [x, y] pairs, in ring order.
 * @param {number[][]} capTris - triangulation of ONE cap, as triples of profile
 *   indices. Rendered double-sided, so cap winding is irrelevant to visibility.
 * @returns {{points:number[][], faceVertexIndices:number[]}} the extruded mesh.
 */
function extrude(profile, capTris) {
  const n = profile.length;
  const points = [];
  profile.forEach(([x, y]) => points.push([x, y, 0]));     // bottom ring  [0..n)
  profile.forEach(([x, y]) => points.push([x, y, Hz]));    // top ring     [n..2n)
  const idx = [];
  for (let i = 0; i < n; i++) {                            // side walls
    const j = (i + 1) % n;
    idx.push(i, j, n + j,  i, n + j, n + i);
  }
  for (const [a, b, c] of capTris) idx.push(a, b, c, n + a, n + b, n + c); // bottom + top caps
  return { points, faceVertexIndices: idx };
}

// I-section cap = 3 rectangles (bottom flange / web / top flange)
const iCap = [[0,1,2],[0,2,11], [10,3,4],[10,4,9], [8,5,6],[8,6,7]];

// --- box (boundary) ----------------------------------------------------------
const box = extrude([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]], [[0,1,2],[0,2,3]]);

/**
 * Build a minimal, offline IFCX layer document for the demo column.
 * @param {string} id - the layer's `header.id`.
 * @param {string} author - the layer's `header.author` (the discipline).
 * @param {object} attrs - attributes to assert on the column path.
 * @param {object} schemas - schema definitions for those attributes.
 * @returns {object} an IFCX file object ready for JSON serialization.
 */
function file(id, author, attrs, schemas) {
  return {
    header: { id, ifcxVersion: "ifcx_alpha", dataVersion: "1.0.0", author, timestamp: "2026-06-02" },
    imports: [], schemas,
    data: [{ path: COL, attributes: attrs }],
  };
}
const meshSchema = { "usd::usdgeom::mesh": { value: { dataType: "Object" } } };
const curveSchema = { "usd::usdgeom::basiscurves": { value: { dataType: "Object" } } };

const tiers = {
  // tier P also tombstones the inherited mesh (null) so the architect's box does
  // not win over the profile curve in the viewer's mesh-before-curve traversal.
  "tier-P.ifcx": file("demo/.../tiers/profile@v1.ifcx", "@architect",
    { "usd::usdgeom::mesh": null,
      "usd::usdgeom::basiscurves": { points: [...P, P[0]].map(([x, y]) => [x, y, 0]) } },
    { ...meshSchema, ...curveSchema }),
  "tier-B.ifcx": file("demo/.../tiers/boundary@v1.ifcx", "@architect",
    { "usd::usdgeom::mesh": box }, meshSchema),
  "tier-M.ifcx": file("demo/.../tiers/mesh@v1.ifcx", "@structural",
    { "usd::usdgeom::mesh": extrude(P, iCap) }, meshSchema),
};

for (const [name, obj] of Object.entries(tiers)) {
  fs.writeFileSync(path.join(DIR, name), JSON.stringify(obj, null, 2) + "\n");
  const a = obj.data[0].attributes;
  const m = a["usd::usdgeom::mesh"];
  console.log(`wrote ${name.padEnd(12)} ${m ? `mesh: ${m.points.length} pts / ${m.faceVertexIndices.length/3} tris` : `curve: ${a["usd::usdgeom::basiscurves"].points.length} pts`}`);
}
