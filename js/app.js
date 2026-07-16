document.addEventListener('DOMContentLoaded', () => {
    const editor = new window.ScriptEditor();
    const statBadge = document.getElementById('page-estimate');
    const saveStatus = document.getElementById('save-status');
    const sceneList = document.getElementById('scene-list');
    
    let titleData = { title: '', author: '', contact: '' };
    let saveTimeout;

    // ==========================================================================
    // Auto-Save & Legacy Cache Recovery
    // ==========================================================================
    
    function triggerAutoSave() {
        // UI Pulse
        saveStatus.classList.add('visible', 'saving');
        document.getElementById('save-text').textContent = "Saving...";
        
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const scriptData = editor.getScriptData();
            const payload = { titlePage: titleData, script: scriptData };
            localStorage.setItem('simpleSlateCache', JSON.stringify(payload));
            
            // Rebuild character autocomplete cache
            window.ScriptFormatter.rebuildCharacterCache(scriptData);
            
            saveStatus.classList.remove('saving');
            document.getElementById('save-text').textContent = "Saved";
            setTimeout(() => saveStatus.classList.remove('visible'), 2000);
        }, 800); // 800ms debounce
    }

    function loadFromCache() {
        const newCache = localStorage.getItem('simpleSlateCache');
        if (newCache) {
            parseAndLoadData(JSON.parse(newCache));
            return;
        }

        const possibleOldKeys = ['scriptData', 'slateCache', 'simpleSlateScript'];
        for (let key of possibleOldKeys) {
            const oldData = localStorage.getItem(key);
            if (oldData) {
                try { parseAndLoadData(JSON.parse(oldData)); } catch (e) {}
                return;
            }
        }
        editor.addBlock('scene', 'EXT. ');
    }

    function parseAndLoadData(parsed) {
        if (parsed.script) {
            if (parsed.titlePage) titleData = parsed.titlePage;
            editor.loadScriptData(parsed.script);
            window.ScriptFormatter.rebuildCharacterCache(parsed.script);
            return;
        }
        
        if (Array.isArray(parsed)) {
            const mappedData = parsed.map(block => ({
                format: block.type || block.format || 'action',
                text: block.content || block.text || ''
            }));
            editor.loadScriptData(mappedData);
            window.ScriptFormatter.rebuildCharacterCache(mappedData);
        }
    }

    // ==========================================================================
    // UI Updates & Dynamic Runtime Estimation
    // ==========================================================================

    window.addEventListener('scriptChanged', () => {
        updateSidebar();
        updateEstimates();
        triggerAutoSave();
    });

    function updateSidebar() {
        sceneList.innerHTML = '';
        const scenes = document.querySelectorAll('.format-scene');
        
        scenes.forEach((sceneBlock) => {
            const text = sceneBlock.textContent.trim();
            if (!text) return;

            const li = document.createElement('li');
            li.className = 'scene-item';
            li.textContent = text;
            
            li.addEventListener('click', () => {
                sceneBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                editor.focusBlock(sceneBlock);
            });
            
            sceneList.appendChild(li);
        });
    }

    function updateEstimates() {
        const blocks = editor.getScriptData();
        let totalMs = 0;

        // Dynamic Runtime Weights
        blocks.forEach(block => {
            const charCount = block.text.length;
            switch(block.format) {
                case 'scene': totalMs += 2000; break;
                case 'action': totalMs += (charCount * 60); break; // Slower read
                case 'character': totalMs += 1000; break;
                case 'dialogue': totalMs += (charCount * 45); break; // Faster read
                case 'parenthetical': totalMs += 1500; break;
                case 'transition': totalMs += 2000; break;
                case 'shot': totalMs += 2000; break;
                default: totalMs += (charCount * 50);
            }
        });

        const totalSeconds = Math.floor(totalMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        // Page calculation (fallback to visual height)
        const canvas = document.getElementById('script-canvas');
        const estimatedPages = Math.max(1, Math.ceil(canvas.scrollHeight / 850));

        statBadge.textContent = `Pages: ~${estimatedPages} | Est. Runtime: ${formattedTime}`;
    }

    // ==========================================================================
    // File I/O
    // ==========================================================================

    document.getElementById('btn-save').addEventListener('click', () => {
        const payload = { titlePage: titleData, script: editor.getScriptData() };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (titleData.title ? titleData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'untitled') + '.slate';
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('btn-load').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.slate';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    parseAndLoadData(JSON.parse(event.target.result));
                    triggerAutoSave();
                } catch (err) {
                    alert('Error: Corrupted .slate file.');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // ==========================================================================
    // Native Print Engine (No External Dependencies)
    // ==========================================================================

    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        const printLayer = document.getElementById('print-layer');
        printLayer.innerHTML = '';
        
        // 1. Title Page
        if (titleData.title || titleData.author) {
            const tpDiv = document.createElement('div');
            tpDiv.className = 'print-title-page';
            tpDiv.innerHTML = `
                <h1>${titleData.title || 'UNTITLED'}</h1>
                <p style="margin-bottom: 12pt;">written by</p>
                <p>${titleData.author || 'Anonymous'}</p>
                <div class="print-contact">${titleData.contact || ''}</div>
            `;
            printLayer.appendChild(tpDiv);
        }

        // 2. Clone Blocks
        const canvasClone = document.getElementById('script-canvas').cloneNode(true);
        
        // Clean up interactive elements for print
        canvasClone.querySelectorAll('.block-content').forEach(el => el.removeAttribute('contenteditable'));
        canvasClone.querySelectorAll('.drag-handle').forEach(el => el.remove());
        
        printLayer.appendChild(canvasClone);

        // 3. Trigger Native Print Dialog (User can 'Save as PDF')
        window.print();
        
        // 4. Cleanup
        setTimeout(() => { printLayer.innerHTML = ''; }, 1000);
    });

    // ==========================================================================
    // Title Page Modal
    // ==========================================================================

    const modal = document.getElementById('modal-title-page');
    document.getElementById('btn-title-page').addEventListener('click', () => {
        document.getElementById('tp-title').value = titleData.title;
        document.getElementById('tp-author').value = titleData.author;
        document.getElementById('tp-contact').value = titleData.contact;
        modal.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('btn-save-title').addEventListener('click', () => {
        titleData.title = document.getElementById('tp-title').value;
        titleData.author = document.getElementById('tp-author').value;
        titleData.contact = document.getElementById('tp-contact').value;
        modal.classList.add('hidden');
        triggerAutoSave();
    });

    // Boot Up
    loadFromCache();
    updateEstimates();
});
