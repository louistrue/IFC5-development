# IFC5 Viewer

A web-based prototype viewer for IFC5 (IFCX) files with USD integration, real-time wall modeling, and multi-file federation capabilities.

## 🚀 Features

- **IFC5/IFCX File Viewing**: Load and visualize IFC5 files in 3D
- **Multi-File Federation**: Compose multiple IFCX files with inheritance and reference resolution
- **Real-time Wall Modeling**: Create walls directly in the viewer with proper IFC5 schema
- **USD Integration**: Full USD material and transform support
- **Export Capabilities**: Export to both IFCX and USD formats
- **Interactive Selection**: Click to select objects with property inspection
- **Layer Management**: Toggle visibility and manage multiple files
- **Coordinate System Conversion**: Toggle between Y-up and Z-up coordinate systems

## 🛠️ Technical Architecture

### Core Technologies

- **TypeScript**: Strongly typed codebase for better maintainability
- **Three.js**: 3D rendering engine with WebGL
- **Vite**: Fast build tool with HMR (Hot Module Replacement)
- **ES Modules**: Modern JavaScript module system

### Key Components

#### 1. **IFCXFederation** (`ifcx-federation.ts`)
- Manages multiple IFCX files and their relationships
- Handles inheritance resolution across files
- Builds composed tree structures from federated data
- Schema validation with non-blocking warnings
- Circular reference detection

#### 2. **USDRenderer** (`usd-renderer.ts`)
- Converts USD geometry to Three.js meshes
- Material binding with PBR support
- Transform matrix handling (row-major to column-major conversion)
- Coordinate system conversion (Z-up to Y-up)
- Single node rendering without scene clearing

#### 3. **WallModeler** (`wall-modeler.ts`)
- Interactive wall creation with two-click placement
- Generates proper IFC5 schema-compliant structures
- USD geometry format for walls
- Each wall has unique GUIDs for both wall and body

#### 4. **SelectionManager** (`selection-manager.ts`)
- Raycasting-based object selection
- Multi-selection support (Ctrl+Click)
- Object visibility management
- Wireframe mode toggle
- Properties panel integration

#### 5. **LayerManager** (`layer-manager.ts`)
- UI for managing loaded IFCX files
- File visibility toggles
- Drag-and-drop reordering
- File deletion

## 📁 File Structure

```
ifc5-viewer/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── ifcx-federation.ts      # Multi-file composition system
│   ├── usd-renderer.ts         # USD to Three.js rendering
│   ├── wall-modeler.ts         # Interactive wall creation
│   ├── selection-manager.ts    # Object selection handling
│   ├── layer-manager.ts        # File management UI
│   └── style.css              # Application styles
├── index.html                  # HTML entry point
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript configuration
└── vite.config.ts             # Vite configuration
```

## 🔧 Installation & Setup

```bash
# Clone the repository
git clone [repository-url]
cd ifc5-viewer

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## 🎮 Usage

### Keyboard Controls

- **Click**: Select objects
- **Ctrl+Click**: Multi-select objects
- **H**: Hide selected objects
- **S**: Show selected objects
- **A**: Show all objects
- **W**: Toggle wireframe mode
- **C**: Toggle coordinate conversion (Y-up/Z-up)
- **M**: Toggle wall modeling mode
- **Esc**: Clear selection / Exit modeling mode

### Wall Modeling

1. Press **M** to enter wall modeling mode
2. Click to place the wall start point
3. Click again to place the end point
4. Wall is created with 3m height and 0.2m thickness

### File Management

- Click "Upload Single IFCX File" or drag files to the layer panel
- Toggle visibility with eye icons
- Delete files with trash icons
- Reorder files by dragging

### Export Options

- **Export IFC**: Saves current scene including created walls as IFCX
- **Export USD**: Saves geometry in USD-compatible JSON format

## 🏗️ IFCX Data Structure

### Entry Format
```json
{
  "path": "uuid-without-slashes",
  "attributes": {
    "customdata": {},
    "bsi::ifc::v5a::schema::class": {},
    "usd::usdgeom::mesh::points": [],
    "usd::usdgeom::mesh::faceVertexIndices": []
  },
  "children": {
    "ChildName": "child-uuid"
  }
}
```

### Material Attributes
- `bsi::ifc::v5a::schema::presentation::diffuseColor`: [R, G, B] array
- `bsi::ifc::v5a::schema::presentation::opacity`: 0.0 to 1.0

### USD Geometry
- Points: Flat array of vertex coordinates [x1,y1,z1,x2,y2,z2,...]
- Face indices: Array of vertex indices for triangulated faces
- Face counts: Array of vertex counts per face (typically all 3s)

## 🎨 Material System

The renderer applies materials based on object type:
- **Walls**: Brown/tan (0.8, 0.6, 0.4)
- **Windows**: Semi-transparent blue (0.3, 0.6, 0.9, opacity: 0.7)
- **Spaces**: Very transparent gray (0.9, 0.9, 0.9, opacity: 0.15)
- **Slabs/Floors**: Gray (0.5, 0.5, 0.6)

Materials include polygon offset to prevent Z-fighting on coplanar surfaces.

## 🔄 Coordinate System

The viewer handles both:
- **Z-up** (IFC/USD standard): Default for imported files
- **Y-up** (Three.js standard): Applied via -90° X-axis rotation

Toggle with the **C** key to switch between coordinate systems.

## 🚧 Known Limitations

- Wall modeling creates simple rectangular walls only
- No door/window insertion in created walls
- Limited to triangulated mesh geometry
- No support for NURBS or complex curves
- Export formats are JSON-based, not native IFC STEP or USDA