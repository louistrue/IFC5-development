import * as THREE from 'three';

export interface ParsedMesh {
    name: string;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
}

export function parseUSDAMeshes(usdaText: string, originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const meshRegex = /def Mesh "(.*?)" \{([\s\S]*?)\n\}/g;

    let match;
    while ((match = meshRegex.exec(usdaText)) !== null) {
        const meshName = match[1];
        const meshContent = match[2];

        // Extract face vertex indices
        const indicesMatch = meshContent.match(/int\[\] faceVertexIndices = \[(.*?)\]/s);
        // Extract points
        const pointsMatch = meshContent.match(/point3f\[\] points = \[(.*?)\]/s);

        if (indicesMatch && pointsMatch) {
            try {
                // Parse indices
                const indices = indicesMatch[1]
                    .split(',')
                    .map(s => parseInt(s.trim()))
                    .filter(n => !isNaN(n));

                // Parse points - extract coordinate triplets
                const pointsStr = pointsMatch[1];
                const coordMatches = pointsStr.match(/\((.*?)\)/g);
                const vertices: number[] = [];

                if (coordMatches) {
                    coordMatches.forEach(coord => {
                        const vals = coord
                            .slice(1, -1)
                            .split(',')
                            .map(s => parseFloat(s.trim()));
                        if (vals.length === 3 && vals.every(v => !isNaN(v))) {
                            vertices.push(...vals);
                        }
                    });
                }

                console.log(`Parsed mesh ${meshName}: ${vertices.length / 3} vertices, ${indices.length / 3} faces`);

                if (vertices.length > 0 && indices.length > 0) {
                    // Create Three.js geometry
                    const geometry = new THREE.BufferGeometry();
                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                    geometry.setIndex(indices);
                    geometry.computeVertexNormals();

                    // Extract material properties from USD (if any)
                    let opacity = 1.0;
                    let color: THREE.Color | number = 0x70B7FD;

                    // Look for opacity in USD content
                    const opacityMatch = meshContent.match(/float inputs:opacity = ([\d.]+)/);
                    if (opacityMatch) {
                        opacity = Math.max(0.0, Math.min(1.0, parseFloat(opacityMatch[1])));
                    }

                    // Look for color in USD content
                    const colorMatch = meshContent.match(/color3f inputs:diffuseColor = \(([\d.,\s]+)\)/);
                    if (colorMatch) {
                        const colorVals = colorMatch[1].split(',').map(s => parseFloat(s.trim()));
                        if (colorVals.length === 3) {
                            color = new THREE.Color(colorVals[0], colorVals[1], colorVals[2]);
                        }
                    }

                    // Create material with proper transparency handling
                    const material = new THREE.MeshLambertMaterial({
                        color: color,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: opacity,
                        alphaTest: 0.01, // Helps with depth sorting issues
                        depthWrite: opacity >= 0.99 // Only write depth for fully opaque objects
                    });

                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.name = meshName;
                    meshes.push(mesh);

                    // Store original material for later restoration
                    originalMaterials.set(mesh, material);
                }
            } catch (error) {
                console.error(`Error parsing mesh ${meshName}:`, error);
            }
        }
    }

    return meshes;
} 