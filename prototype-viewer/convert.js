const fs = require('fs');
const path = require('path');

function convertIfcxToUsda(ifcx) {
  let lines = ['#usda 1.0'];
  const nodes = new Map();
  ifcx.data.forEach(entry => {
    nodes.set(entry.path, entry);
  });

  // Build prims
  ifcx.data.forEach(entry => {
    const primType = getPrimType(entry);
    const name = sanitizeName(entry.path);
    lines.push(`def ${primType} \"${name}\" {`);
    if (entry.attributes && entry.attributes['usd::usdgeom::mesh']) {
      const mesh = entry.attributes['usd::usdgeom::mesh'];
      if (mesh.faceVertexIndices) {
        lines.push(`  int[] faceVertexIndices = [${mesh.faceVertexIndices.join(', ')}]`);
      }
      if (mesh.points) {
        const pts = mesh.points.map(p => `(${p.join(', ')})`).join(', ');
        lines.push(`  point3f[] points = [${pts}]`);
      }
    }
    lines.push('}');
  });
  return lines.join('\n');
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function getPrimType(entry) {
  if (entry.attributes && entry.attributes['usd::usdgeom::mesh']) {
    return 'UsdGeom\:Mesh';
  }
  if (entry.attributes && entry.attributes['usd::usdgeom::basiscurves']) {
    return 'UsdGeom\:BasisCurves';
  }
  return 'Xform';
}

module.exports = { convertIfcxToUsda };

if (require.main === module) {
  const [,, inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node convert.js input.ifcx output.usda');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const usda = convertIfcxToUsda(data);
  fs.writeFileSync(outputPath, usda);
  console.log(`Wrote ${outputPath}`);
}
