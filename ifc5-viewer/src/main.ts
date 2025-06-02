import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SelectionManager } from './selection-manager'
import { IFCXFederation, type ComposedNode } from './ifcx-federation'
import { USDRenderer } from './usd-renderer'
import { LayerManager } from './layer-manager'

class IFC5Viewer {
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls
  private selectionManager!: SelectionManager
  private federation!: IFCXFederation
  private usdRenderer!: USDRenderer
  private layerManager!: LayerManager
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

    // Selection Manager
    this.selectionManager = new SelectionManager(this.originalMaterials)
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
      • Esc: Clear selection
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
  }

  private async handleLegacyFileUpload(file: File): Promise<void> {
    try {
      const content = await this.readFileAsText(file)
      const ifcxData = JSON.parse(content)
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

    // Render the composed tree
    const meshes = this.usdRenderer.renderComposedTree(root)

    // Update selection manager
    this.selectionManager.setMeshes(meshes)

    // Update camera if we have geometry
    if (meshes.length > 0) {
      this.fitCameraToObjects(meshes)
    }

    // Update info
    this.updateStats(meshes.length, root)
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
    this.renderer.dispose()
  }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new IFC5Viewer()
})
