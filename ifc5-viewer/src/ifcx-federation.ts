interface IFCXEntry {
    path: string;
    children?: Record<string, string>;
    attributes?: Record<string, any>;
    inherits?: Record<string, string>;
}

interface IFCXData {
    header: any;
    schemas: Record<string, any>;
    data: IFCXEntry[];
}

interface IFCXFile {
    name: string;
    data: IFCXData;
    visible: boolean;
    index: number;
}

export interface ComposedNode {
    name: string;
    path: string;
    attributes: Record<string, any>;
    children: ComposedNode[];
    sourceFiles: string[];
}

interface InputNode {
    path: string;
    children: Record<string, string | null>;
    inherits: Record<string, string | null>;
    attributes: Record<string, any | null>;
}

// Helper function for multi-map behavior
function addToMultiMap<A, B>(map: Map<A, B[]>, key: A, value: B) {
    if (map.has(key)) {
        map.get(key)?.push(value);
    } else {
        map.set(key, [value]);
    }
}

export class IFCXFederation {
    private files: IFCXFile[] = [];
    private composedRoot: ComposedNode | null = null;
    private callbacks: {
        onFilesChanged?: () => void;
        onCompositionChanged?: (root: ComposedNode | null) => void;
    } = {};

    constructor(callbacks?: {
        onFilesChanged?: () => void;
        onCompositionChanged?: (root: ComposedNode | null) => void;
    }) {
        this.callbacks = callbacks || {};
    }

    addFile(name: string, data: IFCXData): void {
        const index = this.files.length;
        const file: IFCXFile = {
            name,
            data,
            visible: true,
            index
        };

        this.files.push(file);
        this.recompose();
        this.callbacks.onFilesChanged?.();
    }

    removeFile(index: number): void {
        if (index >= 0 && index < this.files.length) {
            this.files.splice(index, 1);
            // Update indices
            this.files.forEach((file, i) => file.index = i);
            this.recompose();
            this.callbacks.onFilesChanged?.();
        }
    }

    moveFile(fromIndex: number, toIndex: number): void {
        if (fromIndex >= 0 && fromIndex < this.files.length &&
            toIndex >= 0 && toIndex < this.files.length) {
            const [movedFile] = this.files.splice(fromIndex, 1);
            this.files.splice(toIndex, 0, movedFile);
            // Update indices
            this.files.forEach((file, i) => file.index = i);
            this.recompose();
            this.callbacks.onFilesChanged?.();
        }
    }

    setFileVisibility(index: number, visible: boolean): void {
        if (index >= 0 && index < this.files.length) {
            this.files[index].visible = visible;
            this.recompose();
            this.callbacks.onFilesChanged?.();
        }
    }

    getFiles(): IFCXFile[] {
        return [...this.files];
    }

    getComposedRoot(): ComposedNode | null {
        return this.composedRoot;
    }

    private recompose(): void {
        try {
            const visibleFiles = this.files.filter(f => f.visible);
            if (visibleFiles.length === 0) {
                this.composedRoot = null;
                this.callbacks.onCompositionChanged?.(null);
                return;
            }

            console.log(`Recomposing with ${visibleFiles.length} visible files`);

            // Federation: Combine all visible files
            const federatedData = this.federateFiles(visibleFiles);
            console.log(`Federated data has ${federatedData.data.length} entries`);

            // Composition: Resolve inheritance and references
            const inputNodes = this.toInputNodes(federatedData.data);
            console.log(`Created ${inputNodes.size} input node groups`);

            const compositionNodes = this.convertNodes(inputNodes);
            console.log(`Converted to ${compositionNodes.size} composition nodes`);

            // Validate schemas (non-blocking)
            this.validateSchemas(federatedData.schemas, compositionNodes);

            // Create composed tree
            this.composedRoot = this.createComposedTree(compositionNodes, federatedData.schemas);
            console.log(`Created composed tree:`, this.composedRoot ? `root with ${this.composedRoot.children.length} children` : 'null');

            this.callbacks.onCompositionChanged?.(this.composedRoot);
        } catch (error) {
            console.error('Composition failed:', error);
            this.composedRoot = null;
            this.callbacks.onCompositionChanged?.(null);
        }
    }

    private federateFiles(files: IFCXFile[]): IFCXData {
        const result: IFCXData = {
            header: files[0]?.data.header || {},
            schemas: {},
            data: []
        };

        // Combine schemas (later files override earlier ones)
        files.forEach(file => {
            Object.assign(result.schemas, file.data.schemas);
        });

        // Combine data entries
        files.forEach(file => {
            file.data.data.forEach(entry => {
                result.data.push({
                    ...entry,
                    // Track source file for debugging
                    __sourceFile: file.name
                } as any);
            });
        });

        return result;
    }

    private toInputNodes(data: IFCXEntry[]): Map<string, InputNode[]> {
        const inputNodes = new Map<string, InputNode[]>();

        data.forEach(ifcxNode => {
            console.log(`Processing IFCX entry: ${ifcxNode.path}`);
            console.log(`  Attributes:`, Object.keys(ifcxNode.attributes || {}));

            // Check specifically for USD mesh attributes
            const hasUSDMesh = Object.keys(ifcxNode.attributes || {}).some(key =>
                key.includes('usd::usdgeom::mesh')
            );
            if (hasUSDMesh) {
                console.log(`  ** Found USD mesh attributes! **`);
                console.log(`  USD mesh details:`, ifcxNode.attributes);
            }

            const node: InputNode = {
                path: ifcxNode.path,
                children: ifcxNode.children || {},
                inherits: ifcxNode.inherits || {},
                attributes: ifcxNode.attributes || {}
            };
            addToMultiMap(inputNodes, node.path, node);
        });

        return inputNodes;
    }

    private convertNodes(input: Map<string, InputNode[]>): Map<string, InputNode> {
        const compositionNodes = new Map<string, InputNode>();

        for (const [path, inputNodes] of input) {
            compositionNodes.set(path, this.collapseNodes(path, inputNodes));
        }

        return compositionNodes;
    }

    private collapseNodes(path: string, nodes: InputNode[]): InputNode {
        console.log(`Collapsing ${nodes.length} nodes for path: ${path}`);

        const result: InputNode = {
            path,
            children: {},
            inherits: {},
            attributes: {}
        };

        nodes.forEach((node, index) => {
            console.log(`  Node ${index} attributes:`, Object.keys(node.attributes));

            // Check for USD mesh attributes before merging
            const hasUSDMesh = Object.keys(node.attributes).some(key =>
                key.includes('usd::usdgeom::mesh')
            );
            if (hasUSDMesh) {
                console.log(`    ** Node ${index} has USD mesh attributes! **`);
            }

            // Merge children (later nodes override)
            Object.assign(result.children, node.children);

            // Merge inherits (later nodes override)
            Object.assign(result.inherits, node.inherits);

            // Merge attributes (later nodes override)
            Object.assign(result.attributes, node.attributes);
        });

        console.log(`  Final collapsed attributes:`, Object.keys(result.attributes));

        // Check if USD attributes survived the collapse
        const finalHasUSDMesh = Object.keys(result.attributes).some(key =>
            key.includes('usd::usdgeom::mesh')
        );
        if (finalHasUSDMesh) {
            console.log(`  ** Final node has USD mesh attributes! **`);
        }

        return result;
    }

    private validateSchemas(schemas: Record<string, any>, nodes: Map<string, InputNode>): void {
        // Basic schema validation - can be enhanced
        nodes.forEach(node => {
            Object.keys(node.attributes).forEach(schemaId => {
                if (!schemas[schemaId]) {
                    console.warn(`Missing schema "${schemaId}" referenced by "${node.path}"`);
                }
            });
        });
    }

    private createComposedTree(nodes: Map<string, InputNode>, schemas: Record<string, any>): ComposedNode | null {
        // Find root nodes (nodes with no parents)
        const rootPaths = this.findRootPaths(nodes);

        if (rootPaths.length === 0) {
            return null;
        }

        let result: ComposedNode | null = null;

        // Create artificial root if multiple roots
        if (rootPaths.length === 1) {
            const rootPath = rootPaths[0];
            const rootNode = nodes.get(rootPath);

            // Special case: if root node only has inheritance and no children/attributes,
            // expand the inherited node instead
            if (rootNode &&
                Object.keys(rootNode.children).length === 0 &&
                Object.keys(rootNode.attributes).length === 0 &&
                Object.keys(rootNode.inherits).length > 0) {

                console.log(`Root node ${rootPath} only has inheritance, expanding inherited nodes instead`);

                // If single inheritance, use that as root
                const inheritPaths = Object.values(rootNode.inherits).filter(p => p);
                if (inheritPaths.length === 1 && inheritPaths[0]) {
                    const inheritPath = this.getHead(inheritPaths[0]);
                    console.log(`Using inherited node ${inheritPath} as root`);
                    result = this.expandNode(inheritPath, nodes, schemas, []);
                } else {
                    // Multiple inheritance - create artificial root
                    const artificialRoot: ComposedNode = {
                        name: 'Root',
                        path: '',
                        attributes: {},
                        children: [],
                        sourceFiles: []
                    };

                    inheritPaths.forEach(inheritPath => {
                        if (inheritPath) {
                            const child = this.expandNode(this.getHead(inheritPath), nodes, schemas, []);
                            if (child) {
                                artificialRoot.children.push(child);
                            }
                        }
                    });

                    result = artificialRoot;
                }
            } else {
                // Normal case - expand the root node
                result = this.expandNode(rootPath, nodes, schemas, []);
            }
        } else {
            const artificialRoot: ComposedNode = {
                name: 'Root',
                path: '',
                attributes: {},
                children: [],
                sourceFiles: []
            };

            rootPaths.forEach(rootPath => {
                const rootNode = nodes.get(rootPath);

                // Apply same inheritance-only logic as single root case
                if (rootNode &&
                    Object.keys(rootNode.children).length === 0 &&
                    Object.keys(rootNode.attributes).length === 0 &&
                    Object.keys(rootNode.inherits).length > 0) {

                    console.log(`Root node ${rootPath} only has inheritance, expanding inherited nodes instead`);

                    // Expand each inherited node
                    Object.values(rootNode.inherits).forEach(inheritPath => {
                        if (inheritPath) {
                            const child = this.expandNode(this.getHead(inheritPath), nodes, schemas, []);
                            if (child) {
                                artificialRoot.children.push(child);
                            }
                        }
                    });
                } else {
                    // Normal case - expand the root node
                    const child = this.expandNode(rootPath, nodes, schemas, []);
                    if (child) {
                        artificialRoot.children.push(child);
                    }
                }
            });

            result = artificialRoot;
        }

        // Debug: Log the final tree structure
        if (result) {
            console.log('=== FINAL COMPOSED TREE DEBUG ===');
            this.debugLogNode(result, 0);
            console.log('=== END FINAL TREE DEBUG ===');
        }

        return result;
    }

    private debugLogNode(node: ComposedNode, depth: number): void {
        const indent = '  '.repeat(depth);
        console.log(`${indent}Node: ${node.path} (${node.name})`);
        console.log(`${indent}  Attributes: [${Object.keys(node.attributes).join(', ')}]`);

        // Check specifically for USD mesh attributes
        const hasUSDMesh = Object.keys(node.attributes).some(key =>
            key.includes('usd::usdgeom::mesh')
        );
        if (hasUSDMesh) {
            console.log(`${indent}  *** HAS USD MESH DATA ***`);
            const meshAttr = node.attributes['usd::usdgeom::mesh'];
            if (meshAttr) {
                console.log(`${indent}  Mesh data keys:`, Object.keys(meshAttr));
                if (meshAttr.points) {
                    console.log(`${indent}  Points: ${Array.isArray(meshAttr.points) ? meshAttr.points.length : 'not array'} values`);
                }
                if (meshAttr.faceVertexIndices) {
                    console.log(`${indent}  Indices: ${Array.isArray(meshAttr.faceVertexIndices) ? meshAttr.faceVertexIndices.length : 'not array'} values`);
                }
            }
        }

        console.log(`${indent}  Children: ${node.children.length}`);
        node.children.forEach(child => {
            this.debugLogNode(child, depth + 1);
        });
    }

    private findRootPaths(nodes: Map<string, InputNode>): string[] {
        const allPaths = new Set(nodes.keys());
        const childPaths = new Set<string>();

        console.log('=== ROOT PATH DETECTION DEBUG ===');
        console.log(`Total nodes: ${allPaths.size}`);

        // Collect all paths that are referenced as children
        nodes.forEach(node => {
            Object.values(node.children).forEach(childPath => {
                if (childPath) {
                    const head = this.getHead(childPath);
                    childPaths.add(head);
                    console.log(`  Found child reference: ${childPath} (head: ${head})`);
                }
            });
            Object.values(node.inherits).forEach(inheritPath => {
                if (inheritPath) {
                    const head = this.getHead(inheritPath);
                    childPaths.add(head);
                    console.log(`  Found inherit reference: ${inheritPath} (head: ${head})`);
                }
            });
        });

        console.log(`Child/inherit references found: ${childPaths.size}`);
        console.log(`Child/inherit paths:`, Array.from(childPaths));

        // Root paths are those not referenced as children and don't contain "/"
        const candidateRoots = Array.from(allPaths).filter(path =>
            !childPaths.has(path) && !path.includes('/')
        );

        console.log(`Candidate roots (not referenced, no slash): ${candidateRoots.length}`);
        candidateRoots.forEach(path => {
            const node = nodes.get(path);
            const childCount = Object.keys(node?.children || {}).length;
            const inheritCount = Object.keys(node?.inherits || {}).length;
            const attrCount = Object.keys(node?.attributes || {}).length;
            console.log(`  Candidate: ${path} - children: ${childCount}, inherits: ${inheritCount}, attrs: ${attrCount}`);
        });

        console.log('=== END ROOT PATH DETECTION DEBUG ===');

        return candidateRoots;
    }

    private expandNode(
        path: string,
        nodes: Map<string, InputNode>,
        schemas: Record<string, any>,
        visited: string[]
    ): ComposedNode | null {
        if (visited.includes(path)) {
            console.warn(`Circular reference detected: ${path}`);
            return null;
        }

        const node = nodes.get(path);
        if (!node) {
            console.warn(`Node not found: ${path}`);
            return null;
        }

        console.log(`Expanding node: ${path}`);
        console.log(`  Original attributes:`, Object.keys(node.attributes));
        console.log(`  Attribute details:`, node.attributes);

        const composedNode: ComposedNode = {
            name: path.split('/').pop() || path,
            path,
            attributes: { ...node.attributes },
            children: [],
            sourceFiles: []
        };

        const newVisited = [...visited, path];

        // Add inherited attributes
        Object.values(node.inherits).forEach(inheritPath => {
            if (inheritPath) {
                console.log(`  Inheriting from: ${inheritPath}`);
                const inheritedNode = this.expandNode(
                    this.getHead(inheritPath),
                    nodes,
                    schemas,
                    newVisited
                );
                if (inheritedNode) {
                    // Get subnode if path has tail
                    const tail = this.getTail(inheritPath);
                    const targetNode = tail ? this.getNodeByPath(inheritedNode, tail) : inheritedNode;
                    if (targetNode) {
                        console.log(`    Merging attributes from inherited node:`, Object.keys(targetNode.attributes));
                        // Merge attributes (current node wins)
                        Object.assign(composedNode.attributes, targetNode.attributes, composedNode.attributes);
                    }
                }
            }
        });

        // Add children
        Object.entries(node.children).forEach(([childName, childPath]) => {
            if (childPath) {
                console.log(`  Adding child: ${childName} -> ${childPath}`);
                const childNode = this.expandNode(
                    this.getHead(childPath),
                    nodes,
                    schemas,
                    newVisited
                );
                if (childNode) {
                    // Get subnode if path has tail
                    const tail = this.getTail(childPath);
                    const targetNode = tail ? this.getNodeByPath(childNode, tail) : childNode;
                    if (targetNode) {
                        targetNode.name = childName;
                        console.log(`    Successfully adding child ${childName} with attributes: [${Object.keys(targetNode.attributes).join(', ')}]`);
                        composedNode.children.push(targetNode);
                        console.log(`    Parent ${composedNode.path} now has ${composedNode.children.length} children`);
                    } else {
                        console.log(`    Failed to get target node for child ${childName} with tail: ${tail}`);
                    }
                } else {
                    console.log(`    Failed to expand child node for ${childName} -> ${childPath}`);
                }
            }
        });

        console.log(`  Final composed attributes:`, Object.keys(composedNode.attributes));
        console.log(`  Final composed children:`, composedNode.children.length);

        return composedNode;
    }

    private getHead(path: string): string {
        return path.split('/')[0];
    }

    private getTail(path: string): string {
        const parts = path.split('/');
        parts.shift();
        return parts.join('/');
    }

    private getNodeByPath(node: ComposedNode, path: string): ComposedNode | null {
        if (!path) return node;

        const parts = path.split('/');
        const childName = parts[0];
        const child = node.children.find(c => c.name === childName);

        if (!child) return null;

        if (parts.length === 1) return child;

        return this.getNodeByPath(child, parts.slice(1).join('/'));
    }

    // Flatten complex attributes like the reference implementation
    private flattenAttributes(attributes: Record<string, any>, schemas: Record<string, any>): Record<string, any> {
        const flattened: Record<string, any> = {};

        Object.entries(attributes).forEach(([attrName, attr]) => {
            if (attr && typeof attr === 'object' && !Array.isArray(attr)) {
                // Flatten object attributes
                Object.keys(attr).forEach(compName => {
                    flattened[`${attrName}::${compName}`] = attr[compName];
                });
            } else {
                // Add unit support for non-nested attributes
                const schema = schemas[attrName];
                if (schema && schema.value && schema.value.quantityKind) {
                    let postfix = '';
                    const quantityKind = schema.value.quantityKind;
                    if (quantityKind === 'Length') {
                        postfix = 'm';
                    } else if (quantityKind === 'Volume') {
                        postfix = 'm³';
                    } else if (quantityKind === 'Area') {
                        postfix = 'm²';
                    }
                    flattened[attrName] = postfix ? `${attr} ${postfix}` : attr;
                } else {
                    flattened[attrName] = attr;
                }
            }
        });

        return flattened;
    }

    // Get flattened attributes for display
    getFlattenedAttributes(node: ComposedNode): Record<string, any> {
        const schemas = this.files.reduce((acc, file) => ({ ...acc, ...file.data.schemas }), {});
        return this.flattenAttributes(node.attributes, schemas);
    }
} 