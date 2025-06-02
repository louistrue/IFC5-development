import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SelectionManager } from './selection-manager'
import { IFCXFederation, type ComposedNode } from './ifcx-federation'
import { USDRenderer } from './usd-renderer'
import { LayerManager } from './layer-manager'
import { WallModeler } from './wall-modeler'

class IFC5Viewer {
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls
  private selectionManager!: SelectionManager
  private federation!: IFCXFederation
  private usdRenderer!: USDRenderer
  private layerManager!: LayerManager
  private wallModeler!: WallModeler
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private currentRoot: ComposedNode | null = null

  constructor() {
    this.initThreeJS()
    this.initFederation()
    this.initUI()
    this.setupEventListeners()
    this.animate()
  }

  private initThreeJS(): void {
    // Scene
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf0f0f0)

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    this.camera.position.set(10, 10, 10)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    // Add to DOM
    const container = document.getElementById('viewer')
    if (container) {
      container.appendChild(this.renderer.domElement)
    }

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.enablePan = true
    this.controls.enableZoom = true
    this.controls.enableRotate = true

    // Lighting
    this.setupLighting()

    // USD Renderer
    this.usdRenderer = new USDRenderer(this.scene)

    // Selection Manager with coordinate conversion callback
    this.selectionManager = new SelectionManager(
      this.originalMaterials,
      () => this.handleCoordinateConversionToggle()
    )

    // Wall Modeler
    this.wallModeler = new WallModeler(
      this.scene,
      this.camera,
      this.renderer,
      (wall: ComposedNode) => this.handleWallCreated(wall)
    )
  }

  private initFederation(): void {
    this.federation = new IFCXFederation({
      onFilesChanged: () => {
        this.layerManager?.updateUI()
      },
      onCompositionChanged: (root: ComposedNode | null) => {
        this.handleCompositionChanged(root)
      }
    })
  }

  private initUI(): void {
    // Create UI container if it doesn't exist
    let uiContainer = document.getElementById('ui-container')
    if (!uiContainer) {
      uiContainer = document.createElement('div')
      uiContainer.id = 'ui-container'
      uiContainer.style.cssText = `
        position: absolute;
        top: 20px;
        left: 20px;
        width: 320px;
        max-height: calc(100vh - 40px);
        overflow-y: auto;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(10px);
        z-index: 1000;
      `
      document.body.appendChild(uiContainer)
    }

    // Initialize Layer Manager
    const layerContainer = document.createElement('div')
    layerContainer.id = 'layer-container'
    uiContainer.appendChild(layerContainer)

    this.layerManager = new LayerManager(layerContainer, this.federation)

    // Create info panel
    const infoPanel = document.createElement('div')
    infoPanel.id = 'info-panel'
    infoPanel.style.cssText = `
      margin-top: 16px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 6px;
      font-size: 14px;
      color: #333;
    `
    infoPanel.innerHTML = `
      <div id="info">Load IFCX files to get started</div>
      <div id="stats" style="margin-top: 8px; font-size: 12px; color: #666;"></div>
    `
    uiContainer.appendChild(infoPanel)

    // Add legacy file upload for backward compatibility
    const legacyUpload = document.createElement('div')
    legacyUpload.style.marginTop = '16px'
    legacyUpload.innerHTML = `
      <input type="file" id="file-input" accept=".ifcx" style="display: none;">
      <button id="upload-btn" style="
        width: 100%;
        padding: 12px;
        background: #28a745;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      ">Upload Single IFCX File</button>
    `
    uiContainer.appendChild(legacyUpload)

    // Export Controls
    const exportSection = document.createElement('div')
    exportSection.style.marginTop = '16px'
    exportSection.innerHTML = `
      <div style="display: flex; gap: 8px;">
        <button id="export-ifc-btn" style="
          flex: 1;
          padding: 10px;
          background: #28a745;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        ">📁 Export IFC</button>
        <button id="export-usd-btn" style="
          flex: 1;
          padding: 10px;
          background: #6f42c1;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        ">💾 Export USD</button>
      </div>
      <div style="font-size: 11px; color: #666; text-align: center; margin-top: 4px;">
        Export current scene and created walls
      </div>
    `
    uiContainer.appendChild(exportSection)

    // Instructions
    const instructions = document.createElement('div')
    instructions.style.cssText = `
      margin-top: 16px;
      padding: 12px;
      background: #e3f2fd;
      border-radius: 6px;
      font-size: 12px;
      color: #1565c0;
      line-height: 1.4;
    `
    instructions.innerHTML = `
      <strong>Controls:</strong><br>
      • Click: Select objects<br>
      • Ctrl+Click: Multi-select<br>
      • H: Hide selected<br>
      • S: Show selected<br>
      • A: Show all<br>
      • W: Toggle wireframe<br>
      • C: Toggle coordinate conversion<br>
      • M: Toggle wall modeling mode<br>
      • Esc: Clear selection / Exit modeling<br>
      <br>
      <strong>Wall Modeling:</strong><br>
      • Press M to start wall modeling<br>
      • Click two points to create a wall<br>
      • Walls: 3m height, 0.2m thickness<br>
      <br>
      <strong>Export:</strong><br>
      • Export IFC: Save as IFCX format<br>
      • Export USD: Save as USD JSON format
    `
    uiContainer.appendChild(instructions)

    // Ensure properties panel exists
    this.ensurePropertiesPanel()
  }

  private ensurePropertiesPanel(): void {
    if (!document.getElementById('properties-panel')) {
      const panel = document.createElement('div')
      panel.id = 'properties-panel'
      panel.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        width: 400px;
        max-height: calc(100vh - 40px);
        background: rgba(255, 255, 255, 0.95);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(10px);
        z-index: 1000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        overflow-y: auto;
      `
      panel.innerHTML = `
        <div style="padding: 16px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 16px; color: #333;">Properties</h3>
          <button id="close-properties" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666;">&times;</button>
        </div>
        <div id="properties-content" style="padding: 16px;">
          <div class="no-selection">No element selected</div>
        </div>
      `
      panel.classList.add('visible')
      document.body.appendChild(panel)
    }
  }

  private setupLighting(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
    this.scene.add(ambientLight)

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(50, 50, 50)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    this.scene.add(directionalLight)

    // Additional fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
    fillLight.position.set(-50, -50, -50)
    this.scene.add(fillLight)
  }

  private setupEventListeners(): void {
    // Window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })

    // Mouse events
    this.renderer.domElement.addEventListener('click', (event) => {
      this.selectionManager.handleClick(event, this.camera, this.renderer)
    })

    // Keyboard events
    document.addEventListener('keydown', (event) => {
      // Handle wall modeling toggle
      if (event.key.toLowerCase() === 'm') {
        if (this.wallModeler.isModelingActive()) {
          this.wallModeler.stopModeling()
          this.updateInfo('Wall modeling deactivated')
        } else {
          this.wallModeler.startModeling()
          this.updateInfo('Wall modeling active - Click two points to create a wall')
        }
        return
      }

      // Handle escape key for modeling mode
      if (event.key === 'Escape' && this.wallModeler.isModelingActive()) {
        this.wallModeler.stopModeling()
        this.updateInfo('Wall modeling deactivated')
        return
      }

      // Pass other events to selection manager
      this.selectionManager.handleKeyDown(event)
    })

    // Legacy file upload
    const uploadBtn = document.getElementById('upload-btn')
    const fileInput = document.getElementById('file-input') as HTMLInputElement

    uploadBtn?.addEventListener('click', () => {
      fileInput.click()
    })

    fileInput?.addEventListener('change', async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (file) {
        await this.handleLegacyFileUpload(file)
      }
    })

    // Export buttons
    const exportIfcBtn = document.getElementById('export-ifc-btn')
    const exportUsdBtn = document.getElementById('export-usd-btn')

    exportIfcBtn?.addEventListener('click', () => {
      this.exportToIFC()
    })

    exportUsdBtn?.addEventListener('click', () => {
      this.exportToUSD()
    })
  }

  private async handleLegacyFileUpload(file: File): Promise<void> {
    try {
      const content = await this.readFileAsText(file)
      const ifcxData = JSON.parse(content)

      // Debug: Check what attributes are in the original file
      console.log('=== ORIGINAL IFCX FILE DEBUG ===')
      console.log(`File: ${file.name}`)
      console.log(`Total entries: ${ifcxData.data?.length || 0}`)

      // Sample first few entries to see their attributes
      if (ifcxData.data && ifcxData.data.length > 0) {
        console.log('Sample entries from original file:')
        ifcxData.data.slice(0, 10).forEach((entry: any, index: number) => {
          console.log(`Entry ${index}: ${entry.path}`)
          console.log(`  Attributes: [${Object.keys(entry.attributes || {}).join(', ')}]`)
          if (entry.attributes) {
            Object.entries(entry.attributes).forEach(([key, value]) => {
              if (typeof value === 'object') {
                console.log(`    ${key}: ${JSON.stringify(value).substring(0, 100)}...`)
              } else {
                console.log(`    ${key}: ${value}`)
              }
            })
          }
        })
      }

      // Check schemas
      console.log(`Schemas: [${Object.keys(ifcxData.schemas || {}).join(', ')}]`)
      console.log('=== END ORIGINAL FILE DEBUG ===')

      this.federation.addFile(file.name, ifcxData)
      this.updateInfo(`Loaded: ${file.name}`)
    } catch (error) {
      console.error('Failed to load file:', error)
      this.updateInfo(`Failed to load: ${file.name}`)
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  }

  private handleCompositionChanged(root: ComposedNode | null): void {
    this.currentRoot = root

    // Render the composed tree with coordinate conversion option from selection manager
    const enableCoordinateConversion = this.selectionManager.getCoordinateConversionEnabled()
    const meshes = this.usdRenderer.renderComposedTree(root, { enableCoordinateConversion })

    // Update selection manager
    this.selectionManager.setMeshes(meshes)

    // Update camera if we have geometry
    if (meshes.length > 0) {
      this.fitCameraToObjects(meshes)
    }

    // Update info
    this.updateStats(meshes.length, root)
  }

  private handleCoordinateConversionToggle(): void {
    // Re-render the scene with the new coordinate conversion setting
    if (this.currentRoot) {
      this.handleCompositionChanged(this.currentRoot)
    }
  }

  private fitCameraToObjects(objects: THREE.Object3D[]): void {
    if (objects.length === 0) return

    const boundingBox = new THREE.Box3()
    objects.forEach(obj => {
      boundingBox.expandByObject(obj)
    })

    if (!boundingBox.isEmpty()) {
      const center = boundingBox.getCenter(new THREE.Vector3())
      const size = boundingBox.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)

      const distance = maxDim * 1.5
      this.camera.position.copy(center)
      this.camera.position.add(new THREE.Vector3(distance, distance, distance))
      this.camera.lookAt(center)
      this.controls.target.copy(center)
      this.controls.update()

      // Debug camera and scene bounds
      console.log(`📷 Camera positioned:`, {
        sceneCenter: `(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
        sceneSize: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`,
        cameraPos: `(${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)})`,
        distance: distance.toFixed(2),
        objectCount: objects.length
      });
    }
  }

  private handleWallCreated(wall: ComposedNode): void {
    console.log('🏗️ Wall created, adding to existing scene:', wall.name)

    // Render the created wall without clearing existing geometry
    const meshes = this.usdRenderer.renderSingleNode(wall, {
      enableCoordinateConversion: this.selectionManager.getCoordinateConversionEnabled()
    })

    // Update selection manager with all current meshes
    const allMeshes = this.usdRenderer.getMeshes()
    this.selectionManager.setMeshes(allMeshes)

    console.log(`✅ Wall added successfully. Total meshes in scene: ${allMeshes.length}`)
    this.updateInfo(`Created wall: ${wall.name} (${allMeshes.length} total objects)`)
  }

  private exportToIFC(): void {
    try {
      console.log('📁 Starting IFC export...')

      // Get created walls from wall modeler
      const createdWalls = this.wallModeler.getCreatedWalls()

      // Get current federation data
      const federationFiles = this.federation.getFiles()

      // Combine original data with created walls
      const allEntries: any[] = []

      // Add original federation data
      federationFiles.forEach(file => {
        if (file.data && file.data.data) {
          allEntries.push(...file.data.data.map((entry: any) => ({
            ...entry,
            source: file.name
          })))
        }
      })

      // Add created walls
      createdWalls.forEach(wall => {
        // Convert ComposedNode to IFCX entry format (wall paths are now just UUIDs)
        const wallEntry = {
          path: wall.path, // Already a UUID without leading slash
          attributes: wall.attributes,
          children: wall.children.reduce((acc: Record<string, string>, child) => {
            // Child path is now also just a UUID
            acc[child.name] = child.path;
            return acc;
          }, {}),
          source: 'IFC5Viewer-Created'
        };

        allEntries.push(wallEntry);

        // Also add the child nodes (like Body) - each has its own UUID now
        wall.children.forEach(child => {
          const childEntry = {
            path: child.path, // Already a UUID
            attributes: child.attributes,
            children: child.children.reduce((acc: Record<string, string>, grandchild) => {
              acc[grandchild.name] = grandchild.path;
              return acc;
            }, {}),
            source: 'IFC5Viewer-Created'
          };
          allEntries.push(childEntry);
        });
      })

      // Create IFCX export data
      const ifcxExport = {
        header: {
          generator: 'IFC5Viewer',
          version: '1.0',
          timestamp: new Date().toISOString(),
          description: 'IFC5 export including original geometry and created walls'
        },
        schemas: {
          'bsi::ifc::v5a::schema': {},
          'usd': {},
          'bsi::ifc::v5a::prop': {},
          'customdata': {}
        },
        data: allEntries
      }

      // Debug the export structure
      console.log('🔍 Export structure check:')
      allEntries.slice(0, 3).forEach((entry, index) => {
        console.log(`Entry ${index}:`, {
          path: entry.path,
          pathType: typeof entry.path,
          hasAttributes: !!entry.attributes,
          hasChildren: !!entry.children,
          source: entry.source
        })
      })

      // Debug created walls specifically
      const createdWallEntries = allEntries.filter(entry => entry.source === 'IFC5Viewer-Created')
      if (createdWallEntries.length > 0) {
        console.log('🏗️ Created wall entries in export:')
        createdWallEntries.forEach((entry, index) => {
          console.log(`Created Entry ${index}:`, {
            path: entry.path,
            attributes: Object.keys(entry.attributes || {}),
            children: entry.children,
            hasGeometry: !!(entry.attributes && entry.attributes['usd::usdgeom::mesh::points'])
          })
        })
      }

      // Download as file
      const blob = new Blob([JSON.stringify(ifcxExport, null, 2)], {
        type: 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ifc5-export-${new Date().toISOString().split('T')[0]}.ifcx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      this.updateInfo(`IFC exported: ${allEntries.length} objects`)
      console.log(`✅ IFC export complete: ${allEntries.length} objects exported`)

    } catch (error) {
      console.error('❌ IFC export failed:', error)
      this.updateInfo('IFC export failed - see console')
    }
  }

  private exportToUSD(): void {
    try {
      console.log('💾 Starting USD export...')

      // Get all current meshes
      const meshes = this.usdRenderer.getMeshes()
      const createdWalls = this.wallModeler.getCreatedWalls()

      // Create USD format export
      const usdExport = {
        metadata: {
          generator: 'IFC5Viewer',
          version: '1.0',
          timestamp: new Date().toISOString(),
          coordinateSystem: this.selectionManager.getCoordinateConversionEnabled() ? 'Y-up' : 'Z-up'
        },
        scene: {
          defaultPrim: 'World',
          upAxis: this.selectionManager.getCoordinateConversionEnabled() ? 'Y' : 'Z'
        },
        prims: [] as any[]
      }

      // Add created walls to USD export
      createdWalls.forEach((wall, index) => {
        const bodyChild = wall.children.find(child => child.name === 'Body')
        if (bodyChild) {
          const points = bodyChild.attributes['usd::usdgeom::mesh::points']
          const indices = bodyChild.attributes['usd::usdgeom::mesh::faceVertexIndices']
          const faceCounts = bodyChild.attributes['usd::usdgeom::mesh::faceVertexCounts']

          usdExport.prims.push({
            path: `/World/${wall.name}`,
            type: 'Mesh',
            attributes: {
              points: points,
              faceVertexIndices: indices,
              faceVertexCounts: faceCounts,
              material: {
                diffuseColor: wall.attributes['bsi::ifc::v5a::schema::presentation::diffuseColor'] || [0.8, 0.6, 0.4],
                opacity: wall.attributes['bsi::ifc::v5a::schema::presentation::opacity'] || 1.0
              }
            },
            metadata: {
              ifcClass: wall.attributes['bsi::ifc::v5a::schema::class']?.code || 'IfcWall',
              createdBy: 'IFC5Viewer'
            }
          })
        }
      })

      // Add existing scene meshes
      meshes.forEach((mesh, index) => {
        const composedNode = this.usdRenderer.getComposedNodeForMesh(mesh)
        if (composedNode) {
          // Extract geometry from mesh
          const geometry = mesh.geometry
          const positions = geometry.attributes.position?.array
          const indices = geometry.index?.array

          if (positions) {
            usdExport.prims.push({
              path: `/World/Mesh_${index}`,
              type: 'Mesh',
              attributes: {
                points: Array.from(positions),
                faceVertexIndices: indices ? Array.from(indices) : undefined,
                material: {
                  diffuseColor: [0.6, 0.6, 0.6],
                  opacity: 1.0
                }
              },
              metadata: {
                originalPath: composedNode.path,
                originalName: composedNode.name
              }
            })
          }
        }
      })

      // Download as file
      const blob = new Blob([JSON.stringify(usdExport, null, 2)], {
        type: 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `usd-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      this.updateInfo(`USD exported: ${usdExport.prims.length} objects`)
      console.log(`✅ USD export complete: ${usdExport.prims.length} objects exported`)

    } catch (error) {
      console.error('❌ USD export failed:', error)
      this.updateInfo('USD export failed - see console')
    }
  }

  private updateInfo(message: string): void {
    const info = document.getElementById('info')
    if (info) {
      info.textContent = message
    }
  }

  private updateStats(meshCount: number, root: ComposedNode | null): void {
    const stats = document.getElementById('stats')
    if (stats) {
      const fileCount = this.federation.getFiles().length
      const nodeCount = root ? this.countNodes(root) : 0
      stats.textContent = `Files: ${fileCount} | Nodes: ${nodeCount} | Meshes: ${meshCount}`
    }
  }

  private countNodes(node: ComposedNode): number {
    let count = 1
    node.children.forEach(child => {
      count += this.countNodes(child)
    })
    return count
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  public dispose(): void {
    this.selectionManager.dispose()
    this.usdRenderer.dispose()
    this.layerManager.dispose()
    this.wallModeler.dispose()
    this.renderer.dispose()
  }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new IFC5Viewer()
})