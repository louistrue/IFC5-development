interface IFCXEntry {
    path: string;
    children?: Record<string, string>;
    attributes?: Record<string, any>;
    inherits?: Record<string, string>;
}

interface IFCXData {
    header: any;
    schemas: any;
    data: IFCXEntry[];
}

export function convertIfcxToUsda(ifcx: IFCXData): string {
    const lines: string[] = ['#usda 1.0'];
    const nodes = new Map<string, IFCXEntry>();
    const usedNames = new Set<string>(); // Track used prim names

    ifcx.data.forEach(entry => {
        nodes.set(entry.path, entry);
    });

    // Build prims
    ifcx.data.forEach(entry => {
        const primType = getPrimType(entry);
        let name = sanitizeName(entry.path);

        // Ensure name uniqueness
        let uniqueName = name;
        let counter = 1;
        while (usedNames.has(uniqueName)) {
            uniqueName = `${name}_${counter}`;
            counter++;
        }
        usedNames.add(uniqueName);

        lines.push(`def ${primType} "${uniqueName}" {`);

        if (entry.attributes && entry.attributes['usd::usdgeom::mesh']) {
            const mesh = entry.attributes['usd::usdgeom::mesh'];

            if (mesh.faceVertexIndices) {
                lines.push(`  int[] faceVertexIndices = [${mesh.faceVertexIndices.join(', ')}]`);
            }

            if (mesh.points) {
                const pts = mesh.points.map((p: number[]) => `(${p.join(', ')})`).join(', ');
                lines.push(`  point3f[] points = [${pts}]`);
            }
        }

        lines.push('}');
    });

    return lines.join('\n');
}

function sanitizeName(name: string): string {
    let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    // USD prim names must start with a letter or underscore
    if (sanitized && /^[0-9]/.test(sanitized)) {
        sanitized = '_' + sanitized;
    }
    return sanitized || '_default';
}

function getPrimType(entry: IFCXEntry): string {
    if (entry.attributes && entry.attributes['usd::usdgeom::mesh']) {
        return 'Mesh';
    }
    if (entry.attributes && entry.attributes['usd::usdgeom::basiscurves']) {
        return 'BasisCurves';
    }
    return 'Xform';
} 