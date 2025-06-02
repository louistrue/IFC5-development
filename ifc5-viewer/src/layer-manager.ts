import type { IFCXFederation } from './ifcx-federation';

interface IFCXFile {
    name: string;
    visible: boolean;
    index: number;
}

export class LayerManager {
    private container: HTMLElement;
    private federation: IFCXFederation;
    private callbacks: {
        onSelectionChanged?: (fileIndex: number | null) => void;
    } = {};

    constructor(container: HTMLElement, federation: IFCXFederation, callbacks?: {
        onSelectionChanged?: (fileIndex: number | null) => void;
    }) {
        this.container = container;
        this.federation = federation;
        this.callbacks = callbacks || {};
        this.createUI();
        this.updateUI();
    }

    private createUI(): void {
        this.container.innerHTML = `
            <div class="layer-manager">
                <div class="layer-header">
                    <h3>Layers</h3>
                    <input type="file" id="add-file-input" accept=".ifcx" multiple style="display: none;">
                    <button id="add-layer-btn" class="add-btn">+ Add Layer</button>
                </div>
                <div id="layer-list" class="layer-list">
                    <!-- Layers will be populated here -->
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .layer-manager {
                background: #f5f5f5;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 16px;
            }

            .layer-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }

            .layer-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: #333;
            }

            .add-btn {
                background: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 8px 12px;
                font-size: 12px;
                cursor: pointer;
                transition: background-color 0.2s;
            }

            .add-btn:hover {
                background: #0056b3;
            }

            .layer-list {
                max-height: 300px;
                overflow-y: auto;
            }

            .layer-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                margin-bottom: 4px;
                background: white;
                border-radius: 4px;
                border: 1px solid #ddd;
                transition: all 0.2s;
            }

            .layer-item:hover {
                border-color: #007bff;
                box-shadow: 0 2px 4px rgba(0,123,255,0.1);
            }

            .layer-item.selected {
                border-color: #007bff;
                background: #f0f8ff;
            }

            .layer-info {
                display: flex;
                align-items: center;
                flex: 1;
                min-width: 0;
            }

            .layer-visibility {
                width: 16px;
                height: 16px;
                margin-right: 8px;
                cursor: pointer;
                user-select: none;
            }

            .layer-name {
                font-size: 13px;
                color: #333;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex: 1;
            }

            .layer-controls {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-left: 8px;
            }

            .layer-btn {
                width: 24px;
                height: 24px;
                border: none;
                background: #f8f9fa;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.2s;
            }

            .layer-btn:hover {
                background: #e9ecef;
            }

            .layer-btn.up:hover {
                background: #d4edda;
            }

            .layer-btn.down:hover {
                background: #d4edda;
            }

            .layer-btn.delete:hover {
                background: #f8d7da;
            }

            .empty-state {
                text-align: center;
                padding: 24px;
                color: #666;
                font-size: 14px;
            }
        `;
        document.head.appendChild(style);

        // Set up event listeners
        const addButton = document.getElementById('add-layer-btn');
        const fileInput = document.getElementById('add-file-input') as HTMLInputElement;

        addButton?.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput?.addEventListener('change', (event) => {
            const files = (event.target as HTMLInputElement).files;
            if (files) {
                this.handleFileUpload(files);
            }
        });
    }

    private async handleFileUpload(files: FileList): Promise<void> {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const content = await this.readFileAsText(file);
                const ifcxData = JSON.parse(content);
                this.federation.addFile(file.name, ifcxData);
            } catch (error) {
                console.error(`Failed to load file ${file.name}:`, error);
                alert(`Failed to load file ${file.name}: ${error}`);
            }
        }
    }

    private readFileAsText(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    updateUI(): void {
        const layerList = document.getElementById('layer-list');
        if (!layerList) return;

        const files = this.federation.getFiles();

        if (files.length === 0) {
            layerList.innerHTML = `
                <div class="empty-state">
                    No layers loaded<br>
                    <small>Click "Add Layer" to load IFCX files</small>
                </div>
            `;
            return;
        }

        layerList.innerHTML = '';

        files.forEach((file, index) => {
            const layerItem = this.createLayerItem(file, index);
            layerList.appendChild(layerItem);
        });
    }

    private createLayerItem(file: IFCXFile, index: number): HTMLElement {
        const item = document.createElement('div');
        item.className = 'layer-item';
        item.dataset.index = index.toString();

        const visibilityIcon = file.visible ? '👁' : '👁‍🗨';
        const canMoveUp = index > 0;
        const canMoveDown = index < this.federation.getFiles().length - 1;

        item.innerHTML = `
            <div class="layer-info">
                <div class="layer-visibility" title="Toggle visibility">${visibilityIcon}</div>
                <div class="layer-name" title="${file.name}">${file.name}</div>
            </div>
            <div class="layer-controls">
                <button class="layer-btn up" title="Move up" ${!canMoveUp ? 'disabled' : ''}>▲</button>
                <button class="layer-btn down" title="Move down" ${!canMoveDown ? 'disabled' : ''}>▼</button>
                <button class="layer-btn delete" title="Remove layer">×</button>
            </div>
        `;

        // Set up event listeners
        const visibilityBtn = item.querySelector('.layer-visibility');
        const upBtn = item.querySelector('.up');
        const downBtn = item.querySelector('.down');
        const deleteBtn = item.querySelector('.delete');

        visibilityBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.federation.setFileVisibility(index, !file.visible);
        });

        upBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (canMoveUp) {
                this.federation.moveFile(index, index - 1);
            }
        });

        downBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (canMoveDown) {
                this.federation.moveFile(index, index + 1);
            }
        });

        deleteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove layer "${file.name}"?`)) {
                this.federation.removeFile(index);
            }
        });

        // Click to select layer
        item.addEventListener('click', () => {
            // Remove selection from other items
            const allItems = document.querySelectorAll('.layer-item');
            allItems.forEach(i => i.classList.remove('selected'));

            // Select this item
            item.classList.add('selected');
            this.callbacks.onSelectionChanged?.(index);
        });

        return item;
    }

    setSelectedLayer(index: number | null): void {
        const allItems = document.querySelectorAll('.layer-item');
        allItems.forEach(item => item.classList.remove('selected'));

        if (index !== null) {
            const selectedItem = document.querySelector(`[data-index="${index}"]`);
            selectedItem?.classList.add('selected');
        }
    }

    dispose(): void {
        // Clean up event listeners and remove elements
        this.container.innerHTML = '';
    }
} 