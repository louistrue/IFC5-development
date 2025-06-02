import * as THREE from 'three';
import type { ComposedNode } from './ifcx-federation';

export class SelectionManager {
    private selectedObjects: THREE.Mesh[] = [];
    private hiddenObjects: THREE.Mesh[] = [];
    private allMeshes: THREE.Mesh[] = [];
    private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    private composedRoot: ComposedNode | null = null;
    private coordinateConversionEnabled: boolean = true;

    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private onCoordinateConversionToggle?: () => void;

    constructor(
        originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
        onCoordinateConversionToggle?: () => void
    ) {
        this.originalMaterials = originalMaterials;
        this.onCoordinateConversionToggle = onCoordinateConversionToggle;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.setupPropertiesPanel();
    }

    setComposedRoot(root: ComposedNode | null) {
        this.composedRoot = root;
    }

    private setupPropertiesPanel() {
        const closeButton = document.getElementById('close-properties');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.hidePropertiesPanel();
            });
        }
    }

    setMeshes(meshes: THREE.Mesh[]) {
        // Clear selection if no meshes provided
        if (meshes.length === 0) {
            this.clearSelection();
        }
        this.allMeshes = meshes;
    }

    handleClick(event: MouseEvent, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
        // Calculate mouse position in normalized device coordinates
        const rect = renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update the picking ray with the camera and mouse position
        this.raycaster.setFromCamera(this.mouse, camera);

        // Improve raycaster settings for better detection
        this.raycaster.near = 0.1;
        this.raycaster.far = 1000;
        this.raycaster.params.Line = { threshold: 1 };
        this.raycaster.params.Points = { threshold: 1 };

        // Only intersect with visible meshes (exclude hidden objects)
        const visibleMeshes = this.allMeshes.filter(mesh => mesh.visible);

        // Calculate objects intersecting the picking ray - get ALL intersections from visible meshes only
        const intersects = this.raycaster.intersectObjects(visibleMeshes, true);

        console.log('Raycaster intersects:', intersects.length, `(from ${visibleMeshes.length} visible meshes)`);
        if (intersects.length > 0) {
            // Show which objects are actually detected
            const detectedObjects = new Set(intersects.map(i => (i.object as THREE.Mesh).name));
            console.log('Detected objects:', Array.from(detectedObjects));

            intersects.forEach((intersect, index) => {
                console.log(`Intersect ${index}:`, intersect.object.name, 'distance:', intersect.distance);
            });
        }

        if (intersects.length > 0) {
            // Smart selection: prefer more complex geometry when distances are close
            let selectedObject = intersects[0].object as THREE.Mesh;

            if (intersects.length > 1) {
                // Look for more complex geometry within a larger distance threshold
                const closestDistance = intersects[0].distance;
                const distanceThreshold = closestDistance + 5.0; // Increased threshold for better detection

                let bestCandidate = selectedObject;
                let maxComplexity = this.getGeometryComplexity(selectedObject);

                console.log(`Evaluating ${intersects.length} intersects for best selection:`);

                for (let i = 0; i < intersects.length && intersects[i].distance <= distanceThreshold; i++) {
                    const candidate = intersects[i].object as THREE.Mesh;
                    const complexity = this.getGeometryComplexity(candidate);
                    const distance = intersects[i].distance;

                    console.log(`- ${candidate.name}: distance=${distance.toFixed(2)}, complexity=${complexity}`);

                    // Prefer more complex geometry if it's within reasonable distance
                    // Give bonus to complex geometry that's not too far away
                    const distancePenalty = distance - closestDistance;
                    const complexityBonus = complexity > maxComplexity ? (complexity - maxComplexity) * 0.1 : 0;

                    if (complexity > maxComplexity && (distancePenalty <= 5.0 || complexityBonus > distancePenalty)) {
                        bestCandidate = candidate;
                        maxComplexity = complexity;
                        console.log(`  → New best candidate: ${candidate.name} (complexity: ${complexity}, distance penalty: ${distancePenalty.toFixed(2)})`);
                    }
                }

                selectedObject = bestCandidate;
                console.log(`Final selection: ${selectedObject.name} (complexity: ${maxComplexity})`);
            } else if (intersects.length === 1) {
                // Fallback: if only one simple object detected, check for complex geometry nearby
                const singleObjectComplexity = this.getGeometryComplexity(selectedObject);
                if (singleObjectComplexity < 50) { // If it's a simple object
                    console.log('Only simple geometry detected, checking for complex geometry nearby...');

                    // Try a wider raycaster search on visible meshes only
                    const originalThreshold = this.raycaster.params.Line?.threshold || 1;
                    this.raycaster.params.Line = { threshold: 5 };
                    this.raycaster.params.Points = { threshold: 5 };

                    const widerIntersects = this.raycaster.intersectObjects(visibleMeshes, true);

                    // Restore original threshold
                    this.raycaster.params.Line = { threshold: originalThreshold };
                    this.raycaster.params.Points = { threshold: originalThreshold };

                    console.log(`Wider search found ${widerIntersects.length} objects`);

                    // Look for complex geometry in wider search
                    for (const intersect of widerIntersects) {
                        const candidate = intersect.object as THREE.Mesh;
                        const complexity = this.getGeometryComplexity(candidate);
                        if (complexity > singleObjectComplexity && complexity > 50) {
                            selectedObject = candidate;
                            console.log(`Found complex geometry in wider search: ${candidate.name} (complexity: ${complexity})`);
                            break;
                        }
                    }
                }
            }

            console.log('Attempting to select:', selectedObject.name, 'material:', selectedObject.material);
            this.selectObject(selectedObject, event.ctrlKey || event.metaKey);

            // Prevent orbit controls from handling this click
            event.stopPropagation();
        } else {
            console.log('No intersects found');

            // Check if there are hidden objects in this area
            if (this.hiddenObjects.length > 0) {
                const hiddenIntersects = this.raycaster.intersectObjects(this.hiddenObjects, true);
                if (hiddenIntersects.length > 0) {
                    console.log(`Found ${hiddenIntersects.length} hidden objects in this area. Press 'A' to show all objects.`);
                }
            }

            // Clicked on empty space - clear selection if not holding Ctrl
            if (!event.ctrlKey && !event.metaKey) {
                this.clearSelection();
            }
        }
    }

    handleKeyDown(event: KeyboardEvent) {
        switch (event.key.toLowerCase()) {
            case 'h':
                if (this.selectedObjects.length > 0) {
                    this.hideSelectedObjects();
                }
                break;
            case 's':
                if (this.selectedObjects.length > 0) {
                    this.showSelectedObjects();
                }
                break;
            case 'a':
                this.showAllObjects();
                break;
            case 'w':
                this.toggleWireframe();
                break;
            case 'c':
                this.toggleCoordinateConversion();
                break;
            case 'escape':
                this.clearSelection();
                break;
        }
    }

    private selectObject(object: THREE.Mesh, multiSelect: boolean = false) {
        console.log('selectObject called for:', object.name, 'multiSelect:', multiSelect);
        console.log('Current material:', object.material);
        console.log('Material type:', Array.isArray(object.material) ? 'Array' : typeof object.material);

        if (!multiSelect) {
            // Clear previous selection if not multi-selecting
            this.clearSelection();
        }

        if (this.selectedObjects.includes(object)) {
            // Deselect if already selected
            this.deselectObject(object);
        } else {
            // Select the object
            this.selectedObjects.push(object);

            // Store the current material before replacing it (handle both single materials and arrays)
            if (!this.originalMaterials.has(object)) {
                const currentMaterial = object.material;
                this.originalMaterials.set(object, currentMaterial);
                console.log('Stored original material for:', object.name, currentMaterial);
            }

            // Create a new highlight material instance
            const highlightMaterial = new THREE.MeshLambertMaterial({
                color: 0xffff00,
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide
            });

            // Apply highlight material
            object.material = highlightMaterial;
            object.material.needsUpdate = true;

            console.log('Applied highlight material to:', object.name);
            console.log('New material:', object.material);

            console.log(`Selected: ${object.name}`);
        }

        this.updateSelectionInfo();
        this.updatePropertiesPanel();
    }

    private deselectObject(object: THREE.Mesh) {
        const index = this.selectedObjects.indexOf(object);
        if (index > -1) {
            this.selectedObjects.splice(index, 1);
            this.restoreOriginalMaterial(object);
            console.log(`Deselected: ${object.name}`);
        }
    }

    private clearSelection() {
        // Create a copy of the array to avoid modification during iteration
        const objectsToDeselect = [...this.selectedObjects];
        this.selectedObjects = [];

        objectsToDeselect.forEach(obj => {
            this.restoreOriginalMaterial(obj);
        });

        this.updateSelectionInfo();
        this.updatePropertiesPanel();
    }

    private restoreOriginalMaterial(object: THREE.Mesh) {
        const originalMaterial = this.originalMaterials.get(object);
        if (originalMaterial) {
            // Dispose of current material if it's a highlight material
            if (object.material && object.material !== originalMaterial) {
                if (object.material instanceof THREE.Material) {
                    object.material.dispose();
                }
            }

            // Restore the original material
            object.material = originalMaterial;

            // Force material update - handle both single materials and arrays
            if (Array.isArray(originalMaterial)) {
                originalMaterial.forEach(mat => mat.needsUpdate = true);
            } else {
                originalMaterial.needsUpdate = true;
            }

            console.log('Restored original material for:', object.name, originalMaterial);
        }
    }

    private hideSelectedObjects() {
        this.selectedObjects.forEach(obj => {
            obj.visible = false;
            if (!this.hiddenObjects.includes(obj)) {
                this.hiddenObjects.push(obj);
            }
        });
        console.log(`Hidden ${this.selectedObjects.length} objects (total hidden: ${this.hiddenObjects.length})`);
        this.clearSelection();
    }

    private showSelectedObjects() {
        this.selectedObjects.forEach(obj => {
            obj.visible = true;
            const index = this.hiddenObjects.indexOf(obj);
            if (index > -1) {
                this.hiddenObjects.splice(index, 1);
            }
        });
        console.log(`Showed ${this.selectedObjects.length} objects`);
    }

    private showAllObjects() {
        this.allMeshes.forEach(obj => {
            obj.visible = true;
        });
        this.hiddenObjects = [];
        console.log('Showed all objects');
    }

    private updateSelectionInfo() {
        const info = document.getElementById('info');
        if (info) {
            if (this.selectedObjects.length > 0) {
                info.textContent = `Selected: ${this.selectedObjects.length} object(s)`;
            } else {
                info.textContent = '';
            }
        }
    }

    private updatePropertiesPanel() {
        const panel = document.getElementById('properties-panel');
        const content = document.getElementById('properties-content');

        if (!panel || !content) {
            console.error('Properties panel elements not found!');
            return;
        }

        if (this.selectedObjects.length === 0) {
            // No selection
            panel.classList.remove('visible');
            content.innerHTML = '<div class="no-selection">No element selected</div>';
        } else if (this.selectedObjects.length === 1) {
            // Single selection - show detailed properties
            this.showSingleObjectProperties(this.selectedObjects[0], content);
            panel.classList.add('visible');
        } else {
            // Multiple selection - show summary
            this.showMultipleObjectsProperties(this.selectedObjects, content);
            panel.classList.add('visible');
        }
    }

    private showSingleObjectProperties(mesh: THREE.Mesh, content: HTMLElement) {
        // Get the composed node for this mesh
        const composedNode = (mesh as any).__composedNode as ComposedNode | undefined;

        // Create table rows like the reference viewer
        let rows: [string, any][] = [];

        // Add basic information
        rows.push(['Mesh Name', mesh.name]);

        if (composedNode) {
            rows.push(['Node Path', composedNode.path]);
            rows.push(['Node Name', composedNode.name]);

            // Add geometry information
            const geometry = mesh.geometry;
            const position = geometry.attributes.position;
            const index = geometry.index;

            if (position) {
                rows.push(['Vertices', position.count]);
            }
            if (index) {
                rows.push(['Faces', Math.floor(index.count / 3)]);
            }

            // Add bounding box size
            const box = new THREE.Box3().setFromObject(mesh);
            const size = box.getSize(new THREE.Vector3());
            rows.push(['Size', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`]);

            // Add all node attributes (flattened)
            const federation = (window as any).__federation;
            let displayAttributes = composedNode.attributes;

            if (federation && federation.getFlattenedAttributes) {
                try {
                    displayAttributes = federation.getFlattenedAttributes(composedNode);
                } catch (e) {
                    console.warn('Failed to get flattened attributes:', e);
                }
            }

            // Add each attribute as a row
            Object.entries(displayAttributes).forEach(([key, value]) => {
                rows.push([key, value]);
            });
        }

        // Generate HTML table like the reference viewer
        const tableRows = rows.map(([k, v]) => {
            const encodedKey = this.encodeHtmlEntities(k);
            const encodedValue = this.encodeHtmlEntities(
                typeof v === "object" ? JSON.stringify(v) : String(v)
            );
            return `<tr><td>${encodedKey}</td><td>${encodedValue}</td></tr>`;
        }).join('');

        content.innerHTML = `<table border="0">${tableRows}</table>`;
    }

    private encodeHtmlEntities(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    private showMultipleObjectsProperties(meshes: THREE.Mesh[], content: HTMLElement) {
        // Create table rows for multiple selection
        let rows: [string, any][] = [];

        rows.push(['Selection Type', 'Multiple Objects']);
        rows.push(['Count', `${meshes.length} objects`]);

        // Calculate total geometry info
        let totalVertices = 0;
        let totalFaces = 0;

        meshes.forEach(mesh => {
            const position = mesh.geometry.attributes.position;
            const index = mesh.geometry.index;
            if (position) totalVertices += position.count;
            if (index) totalFaces += index.count / 3;
        });

        rows.push(['Total Vertices', totalVertices]);
        rows.push(['Total Faces', Math.floor(totalFaces)]);

        // List selected objects
        meshes.forEach((mesh, index) => {
            rows.push([`Object ${index + 1}`, mesh.name]);
        });

        // Generate HTML table
        const tableRows = rows.map(([k, v]) => {
            const encodedKey = this.encodeHtmlEntities(k);
            const encodedValue = this.encodeHtmlEntities(String(v));
            return `<tr><td>${encodedKey}</td><td>${encodedValue}</td></tr>`;
        }).join('');

        content.innerHTML = `<table border="0">${tableRows}</table>`;
    }

    private hidePropertiesPanel() {
        const panel = document.getElementById('properties-panel');
        if (panel) {
            panel.classList.remove('visible');
        }
    }

    public dispose() {
        // Clear all selections and restore materials
        this.clearSelection();

        // Clear all references
        this.allMeshes = [];
        this.hiddenObjects = [];
        this.composedRoot = null;

        // Hide properties panel
        this.hidePropertiesPanel();
    }

    private getGeometryComplexity(mesh: THREE.Mesh): number {
        const geometry = mesh.geometry;
        const position = geometry.attributes.position;
        const index = geometry.index;

        if (position) {
            return position.count;
        }

        if (index) {
            return index.count / 3;
        }

        return 0;
    }

    private toggleWireframe() {
        this.allMeshes.forEach(mesh => {
            const material = mesh.material;
            if (Array.isArray(material)) {
                material.forEach(mat => {
                    if (mat instanceof THREE.MeshLambertMaterial ||
                        mat instanceof THREE.MeshBasicMaterial ||
                        mat instanceof THREE.MeshPhongMaterial ||
                        mat instanceof THREE.MeshStandardMaterial) {
                        mat.wireframe = !mat.wireframe;
                        mat.needsUpdate = true;
                    }
                });
            } else if (material instanceof THREE.MeshLambertMaterial ||
                material instanceof THREE.MeshBasicMaterial ||
                material instanceof THREE.MeshPhongMaterial ||
                material instanceof THREE.MeshStandardMaterial) {
                material.wireframe = !material.wireframe;
                material.needsUpdate = true;
            }
        });

        console.log('Toggled wireframe mode for all meshes');
    }

    private toggleCoordinateConversion() {
        this.coordinateConversionEnabled = !this.coordinateConversionEnabled;
        console.log('🔄 Coordinate conversion toggled:', this.coordinateConversionEnabled ? 'Z-up to Y-up' : 'Original orientation');
        this.onCoordinateConversionToggle?.();
    }

    getCoordinateConversionEnabled(): boolean {
        return this.coordinateConversionEnabled;
    }
} 