document.addEventListener('DOMContentLoaded', () => {
    const editor = new window.ScriptEditor();
    const statBadge = document.getElementById('page-estimate');
    
    let titleData = { title: '', author: '', contact: '' };

    // ==========================================================================
    // Auto-Save & Legacy Cache Recovery
    // ==========================================================================
    
    function saveToCache() {
        const payload = { titlePage: titleData, script: editor.getScriptData() };
        localStorage.setItem('simpleSlateCache', JSON.stringify(payload));
    }

    function loadFromCache() {
        // First try to load the NEW cache format
        const newCache = localStorage.getItem('simpleSlateCache');
        if (newCache) {
            parseAndLoadData(JSON.parse(newCache));
            return;
        }

        // If not found, aggressively search for OLD ChatGPT SimpleSlate keys
        const possibleOldKeys = ['scriptData', 'slateCache', 'simpleSlateScript'];
        for (let key of possibleOldKeys) {
            const oldData = localStorage.getItem(key);
            if (oldData) {
                console.log("Legacy cache found. Recovering data...");
                try {
                    const parsed = JSON.parse(oldData);
                    parseAndLoadData(parsed);
                } catch (e) {
                    console.error("Failed to parse legacy cache.");
                }
                return;
            }
        }
        
        // If totally empty, initialize a blank scene
        editor.addBlock('scene', 'EXT. ');
    }

    function parseAndLoadData(parsed) {
        // Handle new standard format
        if (parsed.script) {
            if (parsed.titlePage) titleData = parsed.titlePage;
            editor.loadScriptData(parsed.script);
            return;
        }
        
        // Fallback: If the JSON is just an array of objects from the old software
        if (Array.isArray(parsed)) {
            // Map old properties (whatever they were) to the new 'format' and 'text'
            const mappedData = parsed.map(block => ({
                format: block.type || block.format || 'action',
                text: block.content || block.text || ''
            }));
            editor.loadScriptData(mappedData);
        }
    }

    // Bind Auto-Save
    window.addEventListener('scriptChanged', () => {
        updateEstimates();
        saveToCache();
    });

    // ==========================================================================
    // UI Updates
    // ==========================================================================

    function updateEstimates() {
        const canvas = document.getElementById('script-canvas');
        const totalHeight = canvas.scrollHeight;
        const estimatedPages = Math.max(1, Math.ceil(totalHeight / 800));
        statBadge.textContent = `Pages: ${estimatedPages} | Runtime: ${estimatedPages}m`;
    }

    // ==========================================================================
    // Manual Formatting Toolbar Logic
    // ==========================================================================
    
    const fmtButtons = document.querySelectorAll('.fmt-btn');
    fmtButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const format = btn.dataset.format;
            // Get currently focused block
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const node = selection.focusNode;
                const block = node ? (node.nodeType === 3 ? node.parentNode.closest('.script-block') : node.closest('.script-block')) : null;
                
                if (block) {
                    editor.changeFormat(block, format);
                    editor.focusBlock(block);
                }
            }
        });
    });

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
                    saveToCache();
                } catch (err) {
                    alert('Error: Corrupted .slate file.');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // ==========================================================================
    // PDF Export (Fixed Render Pipeline)
    // ==========================================================================

    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        // Create a temporary container on the body so html2pdf can physically "see" it
        const printContainer = document.createElement('div');
        printContainer.style.width = '8.5in';
        printContainer.style.padding = '1in';
        printContainer.style.position = 'absolute';
        printContainer.style.top = '0';
        printContainer.style.left = '-9999px'; // Off-screen but rendered
        printContainer.style.background = 'white';
        printContainer.className = 'pdf-exporting';
        
        if (titleData.title || titleData.author) {
            const tpDiv = document.createElement('div');
            tpDiv.style.height = '9in';
            tpDiv.style.display = 'flex';
            tpDiv.style.flexDirection = 'column';
            tpDiv.style.justifyContent = 'center';
            tpDiv.style.alignItems = 'center';
            tpDiv.style.textAlign = 'center';
            tpDiv.style.pageBreakAfter = 'always';

            tpDiv.innerHTML = `
                <h1 style="font-size: 24pt; text-transform: uppercase; margin-bottom: 24pt;">${titleData.title}</h1>
                <p style="margin-bottom: 12pt;">written by</p>
                <p>${titleData.author}</p>
            `;
            printContainer.appendChild(tpDiv);
        }

        const blocks = document.querySelectorAll('.script-block');
        blocks.forEach(block => {
            const clone = block.cloneNode(true);
            const handle = clone.querySelector('.drag-handle');
            if (handle) handle.remove();
            
            // Force strict styling for PDF capture
            clone.style.fontFamily = "'Courier Prime', monospace";
            clone.style.fontSize = "12pt";
            clone.style.color = "black";
            printContainer.appendChild(clone);
        });

        document.body.appendChild(printContainer);

        const opt = {
            margin:       0, // Margins handled by padding
            filename:     `${titleData.title || 'script'}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(printContainer).save().then(() => {
            document.body.removeChild(printContainer); // Cleanup
        });
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
        saveToCache();
    });

    // Boot
    loadFromCache();
});
