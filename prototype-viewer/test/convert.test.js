const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { convertIfcxToUsda } = require('../convert');

function testConvertHelloWall() {
  const ifcxPath = path.resolve(__dirname, '../../Hello Wall/hello-wall.ifcx');
  const data = JSON.parse(fs.readFileSync(ifcxPath, 'utf8'));
  const usda = convertIfcxToUsda(data);
  assert.ok(usda.startsWith('#usda 1.0'), 'should start with USDA header');
  assert.ok(usda.includes('def'), 'should contain a def statement');
  assert.ok(/UsdGeom:Mesh/.test(usda), 'should contain mesh prim');
  console.log('✓ convert Hello Wall example');
}

try {
  testConvertHelloWall();
  console.log('All tests passed');
} catch (e) {
  console.error('Test failed');
  console.error(e);
  process.exit(1);
}
