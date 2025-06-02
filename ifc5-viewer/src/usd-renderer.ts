import * as THREE from 'three';
import type { ComposedNode } from './ifcx-federation';

interface USDMaterial {
    color: THREE.Color;
    transparent: boolean;
    opacity: number;
    roughness?: number;
    metallic?: number;
}

interface RenderOptions {
    enableTransforms: boolean;
    enableMaterials: boolean;
    enableVisibility: boolean;
}

export class USDRenderer {
    private scene: THREE.Scene;
    private meshes: THREE.Mesh[] = [];
    private materialCache = new Map<string, THREE.Material>();
    private nodeToMeshMap = new Map<string, THREE.Mesh[]>();

    private defaultOptions: RenderOptions = {
        enableTransforms: true,
        enableMaterials: true,
        enableVisibility: true
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

        this.traverseAndRender(root, rootGroup, root, finalOptions);

        this.scene.add(rootGroup);
        return this.meshes;
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
        options: RenderOptions
    ): void {
        console.log(`Traversing node: ${node.path} (${node.name})`);

        // Check USD visibility
        if (options.enableVisibility && this.isInvisible(node)) {
            console.log(`Skipping invisible node: ${node.path}`);
            return;
        }

        let element: THREE.Object3D = new THREE.Group();
        element.name = node.name || node.path;

        // Create mesh if this node has USD geometry
        if (this.hasMeshGeometry(node)) {
            console.log(`Node ${node.path} has mesh geometry, creating mesh...`);
            const mesh = this.createMeshFromNode(node, root, options);
            if (mesh) {
                element = mesh;
                this.meshes.push(mesh);

                // Track node to mesh mapping
                if (!this.nodeToMeshMap.has(node.path)) {
                    this.nodeToMeshMap.set(node.path, []);
                }
                this.nodeToMeshMap.get(node.path)!.push(mesh);
                console.log(`Successfully created mesh for ${node.path}`);
            } else {
                console.log(`Failed to create mesh for ${node.path}`);
            }
        } else if (this.hasCurveGeometry(node)) {
            console.log(`Node ${node.path} has curve geometry, creating line...`);
            const line = this.createLineFromNode(node, root, options);
            if (line) {
                element = line;
                console.log(`Successfully created line for ${node.path}`);
            } else {
                console.log(`Failed to create line for ${node.path}`);
            }
        } else {
            console.log(`Node ${node.path} has no geometry, creating group`);
        }

        parent.add(element);

        // Apply USD transforms
        if (options.enableTransforms && node !== root) {
            this.applyTransform(element, node);
        }

        // Recursively render children
        console.log(`Node ${node.path} has ${node.children.length} children`);
        (node.children || []).forEach((child: ComposedNode) => {
            this.traverseAndRender(child, element, root, options);
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

        console.log(`Checking mesh geometry for ${node.path}:`, {
            hasDirectMeshPoints,
            hasMeshObject,
            hasAnyMeshAttribute,
            allAttributes: Object.keys(node.attributes),
            attributeDetails: node.attributes
        });

        return hasDirectMeshPoints || hasMeshObject || hasAnyMeshAttribute;
    }

    private hasCurveGeometry(node: ComposedNode): boolean {
        return !!(node.attributes['usd::usdgeom::basiscurves::points'] ||
            node.attributes['usd::usdgeom::basiscurves']);
    }

    private createMeshFromNode(node: ComposedNode, root: ComposedNode, options: RenderOptions): THREE.Mesh | null {
        try {
            console.log('Creating mesh for node:', node.path);
            console.log('Available attributes:', Object.keys(node.attributes));

            // Extract geometry data
            let points: number[] | undefined;
            let indices: number[] | undefined;

            // Try different attribute formats
            if (node.attributes['usd::usdgeom::mesh::points']) {
                console.log('Found usd::usdgeom::mesh::points');
                points = Array.isArray(node.attributes['usd::usdgeom::mesh::points'][0])
                    ? node.attributes['usd::usdgeom::mesh::points'].flat()
                    : node.attributes['usd::usdgeom::mesh::points'];
            }

            if (node.attributes['usd::usdgeom::mesh::faceVertexIndices']) {
                console.log('Found usd::usdgeom::mesh::faceVertexIndices');
                indices = node.attributes['usd::usdgeom::mesh::faceVertexIndices'];
            }

            // Fallback to flattened mesh data
            if (!points && node.attributes['usd::usdgeom::mesh']) {
                console.log('Found usd::usdgeom::mesh object');
                const meshData = node.attributes['usd::usdgeom::mesh'];
                console.log('Mesh data structure:', meshData);
                if (meshData.points) {
                    points = Array.isArray(meshData.points[0]) ? meshData.points.flat() : meshData.points;
                }
                if (meshData.faceVertexIndices) {
                    indices = meshData.faceVertexIndices;
                }
            }

            // Try the old converter format as fallback
            if (!points && node.attributes['usd::usdgeom::mesh']) {
                console.log('Trying old converter format...');
                const meshAttr = node.attributes['usd::usdgeom::mesh'];
                if (typeof meshAttr === 'object' && meshAttr !== null) {
                    // Look for nested points and indices
                    if (meshAttr.points) {
                        points = meshAttr.points;
                        console.log('Found points in mesh object:', points?.length || 0, 'values');
                    }
                    if (meshAttr.faceVertexIndices) {
                        indices = meshAttr.faceVertexIndices;
                        console.log('Found indices in mesh object:', indices?.length || 0, 'values');
                    }
                }
            }

            // Last resort: look through all attributes for anything that looks like geometry
            if (!points) {
                console.log('Searching all attributes for geometry data...');
                Object.entries(node.attributes).forEach(([key, value]) => {
                    if (key.includes('mesh') || key.includes('points')) {
                        console.log(`Attribute ${key}:`, typeof value, Array.isArray(value) ? `array[${value.length}]` : value);
                    }
                });
            }

            if (!points || points.length === 0) {
                console.warn(`No valid points found for mesh node: ${node.path}`);
                console.log('Node attributes:', node.attributes);
                return null;
            }

            console.log(`Creating geometry with ${points?.length || 0} point values, ${indices?.length || 0} index values`);

            // Create geometry
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));

            if (indices && indices.length > 0) {
                geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
            }

            geometry.computeVertexNormals();

            // Create material
            const material = options.enableMaterials
                ? this.createMaterialForNode(node, root)
                : new THREE.MeshLambertMaterial({ color: 0x888888 });

            // Create mesh with correct side rendering
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = node.name || node.path;

            // Attach the composed node to the mesh for property display
            (mesh as any).__composedNode = node;

            console.log('Successfully created mesh:', mesh.name);
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

    private createMaterialForNode(node: ComposedNode, root: ComposedNode): THREE.Material {
        // Look for material binding reference
        const materialRef = node.attributes['usd::usdshade::materialbindingapi::material::binding'];

        if (materialRef && materialRef.ref) {
            // Check cache first
            if (this.materialCache.has(materialRef.ref)) {
                return this.materialCache.get(materialRef.ref)!;
            }

            // Find the material node in the root tree
            const materialNode = this.findNodeByPath(root, materialRef.ref);
            if (materialNode) {
                const material = this.createMaterialFromMaterialNode(materialNode);
                this.materialCache.set(materialRef.ref, material);
                return material;
            }
        }

        // Default material
        return new THREE.MeshLambertMaterial({
            color: 0x888888,
            transparent: false,
            opacity: 1,
            side: THREE.DoubleSide
        });
    }

    private createMaterialFromMaterialNode(materialNode: ComposedNode): THREE.Material {
        const usdMaterial: USDMaterial = {
            color: new THREE.Color(0.6, 0.6, 0.6),
            transparent: false,
            opacity: 1
        };

        // Extract color from various possible attributes
        if (materialNode.attributes['bsi::presentation::diffuseColor']) {
            const color = materialNode.attributes['bsi::presentation::diffuseColor'];
            if (Array.isArray(color) && color.length >= 3) {
                usdMaterial.color = new THREE.Color(color[0], color[1], color[2]);
            }
        }

        // Extract opacity
        if (materialNode.attributes['bsi::presentation::opacity'] !== undefined) {
            usdMaterial.opacity = materialNode.attributes['bsi::presentation::opacity'];
            usdMaterial.transparent = usdMaterial.opacity < 1.0;
        }

        // Extract roughness and metallic for PBR
        if (materialNode.attributes['bsi::presentation::roughness'] !== undefined) {
            usdMaterial.roughness = materialNode.attributes['bsi::presentation::roughness'];
        }

        if (materialNode.attributes['bsi::presentation::metallic'] !== undefined) {
            usdMaterial.metallic = materialNode.attributes['bsi::presentation::metallic'];
        }

        // Create appropriate Three.js material
        if (usdMaterial.roughness !== undefined || usdMaterial.metallic !== undefined) {
            // Use PBR material
            return new THREE.MeshStandardMaterial({
                color: usdMaterial.color,
                transparent: usdMaterial.transparent,
                opacity: usdMaterial.opacity,
                roughness: usdMaterial.roughness ?? 0.5,
                metalness: usdMaterial.metallic ?? 0.0,
                side: THREE.DoubleSide
            });
        } else {
            // Use Lambert material
            return new THREE.MeshLambertMaterial({
                color: usdMaterial.color,
                transparent: usdMaterial.transparent,
                opacity: usdMaterial.opacity,
                side: THREE.DoubleSide
            });
        }
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