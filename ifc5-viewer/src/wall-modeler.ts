import * as THREE from 'three';
import type { ComposedNode } from './ifcx-federation';

interface WallParameters {
    height: number;
    thickness: number;
    material: {
        color: [number, number, number];
        opacity: number;
    };
}

interface WallPoint {
    x: number;
    y: number;
    z: number;
}

export class WallModeler {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private renderer: THREE.WebGLRenderer;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private isModeling: boolean = false;
    private startPoint: WallPoint | null = null;
    private previewLine: THREE.Line | null = null;
    private groundPlane: THREE.Plane;
    private createdWalls: ComposedNode[] = [];
    private wallCounter: number = 0;

    private wallParams: WallParameters = {
        height: 3.0,
        thickness: 0.2,
        material: {
            color: [0.8, 0.6, 0.4],
            opacity: 1.0
        }
    };

    private onWallCreatedCallback?: (wall: ComposedNode) => void;

    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera,
        renderer: THREE.WebGLRenderer,
        onWallCreated?: (wall: ComposedNode) => void
    ) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // XY plane at Z=0
        this.onWallCreatedCallback = onWallCreated;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
    }

    private onMouseMove(event: MouseEvent): void {
        if (!this.isModeling || !this.startPoint) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);

        if (intersectPoint) {
            this.updatePreviewLine(this.startPoint, {
                x: intersectPoint.x,
                y: intersectPoint.y,
                z: 0
            });
        }
    }

    private onMouseClick(event: MouseEvent): void {
        if (!this.isModeling) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);

        if (!intersectPoint) return;

        const clickPoint: WallPoint = {
            x: intersectPoint.x,
            y: intersectPoint.y,
            z: 0
        };

        if (!this.startPoint) {
            // First click - set start point
            this.startPoint = clickPoint;
            console.log(`🏗️ Wall start point: (${clickPoint.x.toFixed(2)}, ${clickPoint.y.toFixed(2)})`);
            this.createPreviewLine(clickPoint);
        } else {
            // Second click - create wall
            console.log(`🏗️ Wall end point: (${clickPoint.x.toFixed(2)}, ${clickPoint.y.toFixed(2)})`);
            this.createWall(this.startPoint, clickPoint);
            this.clearPreview();
            this.startPoint = null;
        }
    }

    private createPreviewLine(startPoint: WallPoint): void {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z),
            new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z)
        ]);

        const material = new THREE.LineBasicMaterial({
            color: 0xff0000,
            linewidth: 2
        });

        this.previewLine = new THREE.Line(geometry, material);
        this.previewLine.name = 'WallPreview';
        this.scene.add(this.previewLine);
    }

    private updatePreviewLine(startPoint: WallPoint, endPoint: WallPoint): void {
        if (!this.previewLine) return;

        const positions = [
            startPoint.x, startPoint.y, startPoint.z,
            endPoint.x, endPoint.y, endPoint.z
        ];

        this.previewLine.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(positions), 3)
        );
        this.previewLine.geometry.attributes.position.needsUpdate = true;
    }

    private createWall(startPoint: WallPoint, endPoint: WallPoint): void {
        const wallId = this.generateGUID();
        const bodyId = this.generateGUID(); // Separate UUID for Body
        const wallName = `ModeledWall_${this.wallCounter++}`;

        // Calculate wall geometry
        const wallGeometry = this.calculateWallGeometry(startPoint, endPoint);

        // Create USD/IFCX format ComposedNode
        const wallNode: ComposedNode = {
            path: wallId, // No leading slash, just UUID
            name: wallName,
            attributes: {
                'customdata': {
                    originalStepInstance: `#${1000 + this.wallCounter}=IfcWall('${wallId}',$,'${wallName}',$,$,#1,#2,$,$);`,
                    modeledBy: 'IFC5Viewer',
                    createdAt: new Date().toISOString()
                },
                'bsi::ifc::v5a::schema::class': {
                    code: 'IfcWall',
                    uri: 'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcWall'
                },
                'bsi::ifc::v5a::schema::presentation::diffuseColor': this.wallParams.material.color,
                'bsi::ifc::v5a::schema::presentation::opacity': this.wallParams.material.opacity
            },
            children: [
                {
                    path: bodyId, // Separate UUID for Body
                    name: 'Body',
                    attributes: {
                        'usd::usdgeom::mesh::points': wallGeometry.points,
                        'usd::usdgeom::mesh::faceVertexIndices': wallGeometry.indices,
                        'usd::usdgeom::mesh::faceVertexCounts': wallGeometry.faceCounts
                    },
                    children: []
                }
            ]
        };

        this.createdWalls.push(wallNode);

        console.log(`🏗️ Created wall: ${wallName}`, {
            wallId,
            bodyId,
            startPoint,
            endPoint,
            vertices: wallGeometry.points.length / 3,
            faces: wallGeometry.indices.length / 3
        });

        // Notify callback
        if (this.onWallCreatedCallback) {
            this.onWallCreatedCallback(wallNode);
        }
    }

    private calculateWallGeometry(startPoint: WallPoint, endPoint: WallPoint) {
        // Calculate wall direction and perpendicular
        const wallDir = new THREE.Vector3(
            endPoint.x - startPoint.x,
            endPoint.y - startPoint.y,
            0
        ).normalize();

        const wallPerp = new THREE.Vector3(-wallDir.y, wallDir.x, 0).multiplyScalar(this.wallParams.thickness / 2);

        // 8 vertices for a wall box (4 bottom, 4 top)
        const points = [
            // Bottom face (Z = 0)
            startPoint.x - wallPerp.x, startPoint.y - wallPerp.y, 0,           // 0
            startPoint.x + wallPerp.x, startPoint.y + wallPerp.y, 0,           // 1
            endPoint.x + wallPerp.x, endPoint.y + wallPerp.y, 0,               // 2
            endPoint.x - wallPerp.x, endPoint.y - wallPerp.y, 0,               // 3

            // Top face (Z = height)
            startPoint.x - wallPerp.x, startPoint.y - wallPerp.y, this.wallParams.height,  // 4
            startPoint.x + wallPerp.x, startPoint.y + wallPerp.y, this.wallParams.height,  // 5
            endPoint.x + wallPerp.x, endPoint.y + wallPerp.y, this.wallParams.height,      // 6
            endPoint.x - wallPerp.x, endPoint.y - wallPerp.y, this.wallParams.height       // 7
        ];

        // Face indices (triangulated quads)
        const indices = [
            // Bottom face
            0, 1, 2, 0, 2, 3,
            // Top face  
            4, 6, 5, 4, 7, 6,
            // Side faces
            0, 4, 5, 0, 5, 1,  // Start face
            2, 6, 7, 2, 7, 3,  // End face
            1, 5, 6, 1, 6, 2,  // Right face
            0, 3, 7, 0, 7, 4   // Left face
        ];

        // Face vertex counts (all triangles)
        const faceCounts = new Array(indices.length / 3).fill(3);

        return { points, indices, faceCounts };
    }

    private clearPreview(): void {
        if (this.previewLine) {
            this.scene.remove(this.previewLine);
            this.previewLine.geometry.dispose();
            (this.previewLine.material as THREE.Material).dispose();
            this.previewLine = null;
        }
    }

    private generateGUID(): string {
        // Generate IFC-style GUID
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Public API
    startModeling(): void {
        this.isModeling = true;
        this.renderer.domElement.style.cursor = 'crosshair';
        console.log('🏗️ Wall modeling mode activated. Click to place wall start and end points.');
    }

    stopModeling(): void {
        this.isModeling = false;
        this.renderer.domElement.style.cursor = 'default';
        this.clearPreview();
        this.startPoint = null;
        console.log('🏗️ Wall modeling mode deactivated.');
    }

    isModelingActive(): boolean {
        return this.isModeling;
    }

    setWallParameters(params: Partial<WallParameters>): void {
        this.wallParams = { ...this.wallParams, ...params };
        console.log('🏗️ Wall parameters updated:', this.wallParams);
    }

    getCreatedWalls(): ComposedNode[] {
        return [...this.createdWalls];
    }

    exportToIFCX(): any {
        // Convert created walls to IFCX format
        const ifcxData = {
            metadata: {
                generator: 'IFC5Viewer-WallModeler',
                version: '1.0',
                createdAt: new Date().toISOString()
            },
            entries: this.createdWalls.map((wall, index) => ({
                id: wall.path.substring(1), // Remove leading slash
                attributes: wall.attributes,
                children: wall.children.map(child => ({
                    name: child.name,
                    attributes: child.attributes
                }))
            }))
        };

        console.log('📁 Exported walls to IFCX format:', ifcxData);
        return ifcxData;
    }

    dispose(): void {
        this.stopModeling();
        this.createdWalls = [];
        this.wallCounter = 0;
    }
} 