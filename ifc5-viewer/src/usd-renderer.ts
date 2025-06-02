import * as THREE from 'three';
import type { ComposedNode } from './ifcx-federation';

interface RenderOptions {
    enableTransforms: boolean;
    enableMaterials: boolean;
    enableVisibility: boolean;
    enableCoordinateConversion: boolean;
}

export class USDRenderer {
    private scene: THREE.Scene;
    private meshes: THREE.Mesh[] = [];
    private materialCache = new Map<string, THREE.Material>();
    private nodeToMeshMap = new Map<string, THREE.Mesh[]>();

    private defaultOptions: RenderOptions = {
        enableTransforms: true,
        enableMaterials: true,
        enableVisibility: true,
        enableCoordinateConversion: true
    };

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    renderComposedTree(root: ComposedNode | null, options: Partial<RenderOptions> = {}): THREE.Mesh[] {
        this.clearScene();

        if (!root) {
            return [];
        }

        const finalOptions = { ...this.defaultOptions, ...options };
        const rootGroup = new THREE.Group();
        rootGroup.name = 'IFCXRoot';

        this.traverseAndRender(root, rootGroup, root, finalOptions, 'Root', undefined);

        // Apply coordinate system conversion: IFC/USD typically uses Z-up, Three.js uses Y-up
        // Rotate the entire scene 90 degrees around X axis to convert Z-up to Y-up
        if (finalOptions.enableCoordinateConversion) {
            rootGroup.rotation.x = -Math.PI / 2;
            console.log('🔄 Applied Z-up to Y-up coordinate conversion (rotated -90° around X)');
        }

        this.scene.add(rootGroup);

        // Summary of what was created
        const meshCount = this.meshes.length;
        const meshNames = this.meshes.map(m => m.name).join(', ');
        console.log(`🎯 Rendering complete: ${meshCount} meshes created`);
        if (meshCount > 0) {
            console.log(`   Meshes: ${meshNames}`);
        }

        return this.meshes;
    }

    renderSingleNode(node: ComposedNode, options: Partial<RenderOptions> = {}): THREE.Mesh[] {
        // Render a single node without clearing the scene (for adding walls)
        const finalOptions = { ...this.defaultOptions, ...options };
        const rootGroup = this.scene.getObjectByName('IFCXRoot') as THREE.Group;

        // If no existing root group, create one
        let targetGroup = rootGroup;
        if (!targetGroup) {
            targetGroup = new THREE.Group();
            targetGroup.name = 'IFCXRoot';

            // Apply coordinate system conversion if enabled
            if (finalOptions.enableCoordinateConversion) {
                targetGroup.rotation.x = -Math.PI / 2;
            }

            this.scene.add(targetGroup);
        }

        const newMeshes: THREE.Mesh[] = [];
        const originalMeshCount = this.meshes.length;

        // Temporarily store the original meshes array and create a new one for this node
        const originalMeshes = this.meshes;
        this.meshes = [];

        this.traverseAndRender(node, targetGroup, node, finalOptions, 'New', undefined);

        // Add the new meshes to the main meshes array and track them separately
        newMeshes.push(...this.meshes);
        this.meshes = [...originalMeshes, ...newMeshes];

        console.log(`🎯 Added single node: ${newMeshes.length} new meshes created (total: ${this.meshes.length})`);
        if (newMeshes.length > 0) {
            const meshNames = newMeshes.map(m => m.name).join(', ');
            console.log(`   New meshes: ${meshNames}`);
        }

        return newMeshes;
    }

    private clearScene(): void {
        // Remove existing IFCX objects
        const existingRoot = this.scene.getObjectByName('IFCXRoot');
        if (existingRoot) {
            this.scene.remove(existingRoot);
        }

        // Clear caches
        this.meshes = [];
        this.nodeToMeshMap.clear();

        // Dispose of cached materials
        this.materialCache.forEach(material => material.dispose());
        this.materialCache.clear();
    }

    private traverseAndRender(
        node: ComposedNode,
        parent: THREE.Object3D,
        root: ComposedNode,
        options: RenderOptions,
        parentName?: string,
        parentNode?: ComposedNode
    ): void {
        // Check USD visibility
        if (options.enableVisibility && this.isInvisible(node)) {
            return;
        }

        let element: THREE.Object3D = new THREE.Group();
        element.name = node.name || node.path;

        // Create mesh if this node has USD geometry
        if (this.hasMeshGeometry(node)) {
            const mesh = this.createMeshFromNode(node, root, options, parentName, parentNode);
            if (mesh) {
                element = mesh;
                this.meshes.push(mesh);

                // Track node to mesh mapping
                if (!this.nodeToMeshMap.has(node.path)) {
                    this.nodeToMeshMap.set(node.path, []);
                }
                this.nodeToMeshMap.get(node.path)!.push(mesh);
                console.log(`✓ Created mesh: ${mesh.name}`);

            }
        } else if (this.hasCurveGeometry(node)) {
            const line = this.createLineFromNode(node, root, options);
            if (line) {
                element = line;
            }
        }

        parent.add(element);

        // Apply USD transforms
        if (options.enableTransforms && node !== root) {
            this.applyTransform(element, node);
        }

        // Recursively render children - pass current node as parent context
        const currentName = node.name || 'Unknown';
        (node.children || []).forEach((child: ComposedNode) => {
            this.traverseAndRender(child, element, root, options, currentName, node);
        });
    }

    private isInvisible(node: ComposedNode): boolean {
        return node.attributes['usd::usdgeom::visibility::visibility'] === 'invisible';
    }

    private hasMeshGeometry(node: ComposedNode): boolean {
        // Look for any USD mesh-related attributes
        const hasDirectMeshPoints = !!(node.attributes['usd::usdgeom::mesh::points']);
        const hasMeshObject = !!(node.attributes['usd::usdgeom::mesh']);
        const hasAnyMeshAttribute = Object.keys(node.attributes).some(key =>
            key.includes('usd::usdgeom::mesh') ||
            (key === 'usd::usdgeom::mesh')
        );

        return hasDirectMeshPoints || hasMeshObject || hasAnyMeshAttribute;
    }

    private hasCurveGeometry(node: ComposedNode): boolean {
        return !!(node.attributes['usd::usdgeom::basiscurves::points'] ||
            node.attributes['usd::usdgeom::basiscurves']);
    }

    private createMeshFromNode(node: ComposedNode, root: ComposedNode, options: RenderOptions, parentName?: string, parentNode?: ComposedNode): THREE.Mesh | null {
        try {
            // Extract geometry data
            let points: number[] | undefined;
            let indices: number[] | undefined;

            // Try different attribute formats
            if (node.attributes['usd::usdgeom::mesh::points']) {
                points = Array.isArray(node.attributes['usd::usdgeom::mesh::points'][0])
                    ? node.attributes['usd::usdgeom::mesh::points'].flat()
                    : node.attributes['usd::usdgeom::mesh::points'];
            }

            if (node.attributes['usd::usdgeom::mesh::faceVertexIndices']) {
                indices = node.attributes['usd::usdgeom::mesh::faceVertexIndices'];
            }

            // Fallback to flattened mesh data
            if (!points && node.attributes['usd::usdgeom::mesh']) {
                const meshData = node.attributes['usd::usdgeom::mesh'];
                if (meshData.points) {
                    points = Array.isArray(meshData.points[0]) ? meshData.points.flat() : meshData.points;
                }
                if (meshData.faceVertexIndices) {
                    indices = meshData.faceVertexIndices;
                }
            }

            if (!points || points.length === 0) {
                return null;
            }

            // Create geometry
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));

            if (indices && indices.length > 0) {
                geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
            }

            geometry.computeVertexNormals();

            // Create material
            const material = options.enableMaterials
                ? this.createMaterialForNode(node, root, parentName, parentNode)
                : new THREE.MeshLambertMaterial({ color: 0x888888 });

            // Create mesh with correct side rendering
            const mesh = new THREE.Mesh(geometry, material);

            // Create a more descriptive name by including parent context
            let meshName = node.name || node.path;
            if ((meshName === 'Body' || meshName === 'Void') && parentName) {
                meshName = `${meshName} (${parentName})`;
            }
            mesh.name = meshName;

            // Attach the composed node to the mesh for property display
            (mesh as any).__composedNode = node;

            // Debug mesh positioning and bounds
            const box = new THREE.Box3().setFromObject(mesh);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            console.log(`📐 Mesh "${meshName}":`, {
                vertices: points.length / 3,
                faces: indices ? indices.length / 3 : 0,
                size: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`,
                center: `(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
                bounds: {
                    min: `(${box.min.x.toFixed(2)}, ${box.min.y.toFixed(2)}, ${box.min.z.toFixed(2)})`,
                    max: `(${box.max.x.toFixed(2)}, ${box.max.y.toFixed(2)}, ${box.max.z.toFixed(2)})`
                }
            });

            // Show first few vertices to understand coordinate system (only for walls)
            if (parentName && parentName.toLowerCase().includes('wall') && points.length >= 9) {
                console.log(`🧭 First 3 vertices of "${meshName}":`, [
                    `(${points[0].toFixed(2)}, ${points[1].toFixed(2)}, ${points[2].toFixed(2)})`,
                    `(${points[3].toFixed(2)}, ${points[4].toFixed(2)}, ${points[5].toFixed(2)})`,
                    `(${points[6].toFixed(2)}, ${points[7].toFixed(2)}, ${points[8].toFixed(2)})`
                ]);
            }

            return mesh;
        } catch (error) {
            console.error('Error creating mesh:', error);
            return null;
        }
    }

    private createLineFromNode(node: ComposedNode, root: ComposedNode, options: RenderOptions): THREE.Line | null {
        try {
            // Extract curve points
            let points: number[] | undefined;

            if (node.attributes['usd::usdgeom::basiscurves::points']) {
                points = Array.isArray(node.attributes['usd::usdgeom::basiscurves::points'][0])
                    ? node.attributes['usd::usdgeom::basiscurves::points'].flat()
                    : node.attributes['usd::usdgeom::basiscurves::points'];
            }

            if (!points || points.length === 0) {
                console.warn(`No valid points found for curve node: ${node.path}`);
                return null;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));

            // Create material based on parent material but darker for lines
            const baseMaterial = options.enableMaterials
                ? this.createMaterialForNode(node, root)
                : new THREE.MeshLambertMaterial({ color: new THREE.Color(0x666666), transparent: false, opacity: 1 });

            const lineMaterial = new THREE.LineBasicMaterial({
                color: (baseMaterial as THREE.MeshLambertMaterial).color.clone().multiplyScalar(0.8),
                transparent: (baseMaterial as THREE.MeshLambertMaterial).transparent,
                opacity: (baseMaterial as THREE.MeshLambertMaterial).opacity
            });

            const line = new THREE.Line(geometry, lineMaterial);
            line.name = node.name || node.path;

            // Store reference to composed node
            (line as any).__composedNode = node;

            return line;
        } catch (error) {
            console.error(`Failed to create line for node ${node.path}:`, error);
            return null;
        }
    }

    private createMaterialForNode(node: ComposedNode, root: ComposedNode, parentName?: string, parentComposedNode?: ComposedNode): THREE.Material {
        // Look for material binding on parent node first (like reference viewer)
        let materialRef = null;

        if (parentComposedNode) {
            materialRef = parentComposedNode.attributes['usd::usdshade::materialbindingapi::material::binding'];
            if (materialRef && materialRef.ref) {
                console.log(`🔗 Found material binding on parent ${parentComposedNode.path}: ${materialRef.ref}`);
            }
        }

        // If no parent binding, check current node
        if (!materialRef) {
            materialRef = node.attributes['usd::usdshade::materialbindingapi::material::binding'];
            if (materialRef && materialRef.ref) {
                console.log(`🔗 Found material binding on current node ${node.path}: ${materialRef.ref}`);
            }
        }

        if (materialRef && materialRef.ref) {
            // Check cache first
            if (this.materialCache.has(materialRef.ref)) {
                console.log(`   Using cached material for ${materialRef.ref}`);
                return this.materialCache.get(materialRef.ref)!;
            }

            // Find the material node in the root tree (same as reference viewer)
            const materialNode = this.findNodeByPath(root, materialRef.ref);
            if (materialNode) {
                console.log(`   Found material node at path: ${materialRef.ref}`);
                const material = this.createMaterialFromMaterialNode(materialNode);
                this.materialCache.set(materialRef.ref, material);
                return material;
            } else {
                console.warn(`   Material node not found at path: ${materialRef.ref}`);
            }
        }

        // Check if parent node has direct color attributes (common case)
        if (parentComposedNode) {
            const colorAttr = parentComposedNode.attributes['bsi::ifc::v5a::schema::presentation::diffuseColor'];
            const opacityAttr = parentComposedNode.attributes['bsi::ifc::v5a::schema::presentation::opacity'];

            if (colorAttr || opacityAttr !== undefined) {
                console.log(`🎨 Found direct material attributes on parent ${parentComposedNode.path}`);

                let color = new THREE.Color(0.6, 0.6, 0.6);
                let opacity = 1;
                let transparent = false;

                if (colorAttr && Array.isArray(colorAttr) && colorAttr.length >= 3) {
                    color = new THREE.Color(colorAttr[0], colorAttr[1], colorAttr[2]);
                    console.log(`   Color: [${colorAttr[0]}, ${colorAttr[1]}, ${colorAttr[2]}]`);
                }

                if (opacityAttr !== undefined) {
                    opacity = opacityAttr;
                    transparent = opacity < 1.0;
                    console.log(`   Opacity: ${opacity} (transparent: ${transparent})`);
                }

                return new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: transparent,
                    opacity: opacity,
                    side: THREE.DoubleSide
                });
            }
        }

        // Provide different default materials based on object type/name
        console.log(`🎨 No specific material found for ${node.path}, assigning default based on type`);

        const objectName = (parentName || node.name || '').toLowerCase();

        if (objectName.includes('wall')) {
            console.log(`   Wall material for: ${objectName}`);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.8, 0.6, 0.4), // Stronger brown/tan for walls
                transparent: false,
                opacity: 1,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1
            });
        } else if (objectName.includes('window')) {
            console.log(`   Window material for: ${objectName}`);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.3, 0.6, 0.9), // Stronger blue for windows
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: 2,
                polygonOffsetUnits: 2
            });
        } else if (objectName.includes('space') || objectName.includes('room')) {
            console.log(`   Space material for: ${objectName}`);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.9, 0.9, 0.9), // Light but not too washed out
                transparent: true,
                opacity: 0.15,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });
        } else if (objectName.includes('slab') || objectName.includes('basis')) {
            console.log(`   Slab/floor material for: ${objectName}`);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.5, 0.5, 0.6), // Stronger gray for slabs/floors
                transparent: false,
                opacity: 1,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: 0,
                polygonOffsetUnits: 0
            });
        } else {
            console.log(`   Generic material for: ${objectName}`);
            return new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.6, 0.6, 0.6), // Medium gray for other objects
                transparent: false,
                opacity: 1,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1
            });
        }
    }

    private createMaterialFromMaterialNode(materialNode: ComposedNode): THREE.Material {
        // Default material properties (same as reference viewer)
        let color = new THREE.Color(0.6, 0.6, 0.6);
        let transparent = false;
        let opacity = 1;

        console.log(`🎨 Creating material from node: ${materialNode.path}`);

        // Extract color from diffuseColor attribute - check both full and short names
        const diffuseColorKeys = [
            'bsi::ifc::v5a::schema::presentation::diffuseColor',
            'bsi::presentation::diffuseColor'
        ];

        for (const key of diffuseColorKeys) {
            if (materialNode.attributes[key]) {
                const colorArray = materialNode.attributes[key];
                if (Array.isArray(colorArray) && colorArray.length >= 3) {
                    color = new THREE.Color(colorArray[0], colorArray[1], colorArray[2]);
                    console.log(`   Color: [${colorArray[0]}, ${colorArray[1]}, ${colorArray[2]}]`);
                    break;
                }
            }
        }

        // Extract opacity - check both full and short names
        const opacityKeys = [
            'bsi::ifc::v5a::schema::presentation::opacity',
            'bsi::presentation::opacity'
        ];

        for (const key of opacityKeys) {
            if (materialNode.attributes[key] !== undefined) {
                opacity = materialNode.attributes[key];
                transparent = opacity < 1.0;
                console.log(`   Opacity: ${opacity} (transparent: ${transparent})`);
                break;
            }
        }

        // Use MeshBasicMaterial like the reference viewer
        return new THREE.MeshBasicMaterial({
            color: color,
            transparent: transparent,
            opacity: opacity,
            side: THREE.DoubleSide
        });
    }

    private applyTransform(element: THREE.Object3D, node: ComposedNode): void {
        const transformData = node.attributes['usd::xformop::transform'];

        if (transformData && Array.isArray(transformData) && transformData.length === 16) {
            element.matrixAutoUpdate = false;
            const matrix = new THREE.Matrix4();
            matrix.set(
                transformData[0], transformData[1], transformData[2], transformData[3],
                transformData[4], transformData[5], transformData[6], transformData[7],
                transformData[8], transformData[9], transformData[10], transformData[11],
                transformData[12], transformData[13], transformData[14], transformData[15]
            );
            matrix.transpose(); // USD uses row-major, Three.js uses column-major
            element.matrix.copy(matrix);
            element.updateMatrixWorld(true);
        }
    }

    private findNodeByPath(root: ComposedNode, path: string): ComposedNode | null {
        if (root.path === path) {
            return root;
        }

        // Simple path-based search
        const pathParts = path.split('/').filter(p => p.length > 0);
        let current = root;

        for (const part of pathParts) {
            const child = current.children.find((c: ComposedNode) => c.name === part);
            if (!child) {
                return null;
            }
            current = child;
        }

        return current;
    }

    getMeshes(): THREE.Mesh[] {
        return [...this.meshes];
    }

    getMeshesForNode(nodePath: string): THREE.Mesh[] {
        return this.nodeToMeshMap.get(nodePath) || [];
    }

    getComposedNodeForMesh(mesh: THREE.Mesh): ComposedNode | null {
        return (mesh as any).__composedNode || null;
    }

    dispose(): void {
        this.clearScene();
    }
} 