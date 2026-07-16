document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize the Core Editor
    const editor = new window.ScriptEditor();

    // 2. UI Elements
    const statBadge = document.getElementById('page-estimate');
    const sceneList = document.getElementById('scene-list');
    const printContainer = document.getElementById('print-container');
    
    // 3. Title Page State
    let titleData = {
        title: '',
        author: '',
        contact: ''
    };

    // ==========================================================================
    // Event Listeners & UI Updates
    // ==========================================================================

    // Listen for the custom event dispatched by editor.js
    window.addEventListener('scriptChanged', updateUI);

    function updateUI() {
        updateSidebar();
        updateEstimates();
    }

    function updateSidebar() {
        sceneList.innerHTML = '';
        const scenes = document.querySelectorAll('.format-scene');
        
        scenes.forEach((sceneBlock) => {
            const text = sceneBlock.textContent.trim();
            if (!text) return;

            const li = document.createElement('li');
            li.className = 'scene-item';
            li.textContent = text;
            
            // Clicking a scene jumps you directly to that block
            li.addEventListener('click', () => {
                sceneBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                editor.focusBlock(sceneBlock);
            });
            
            sceneList.appendChild(li);
        });
    }

    function updateEstimates() {
        // Industry standard: ~54 lines per page. 
        // We calculate this dynamically based on pixel height vs standard 11-inch paper.
        const canvas = document.getElementById('script-canvas');
        const totalHeight = canvas.scrollHeight;
        
        // 800px approximates the usable vertical space on a standard formatted page
        const estimatedPages = Math.max(1, Math.ceil(totalHeight / 800));
        
        // Standard cinematic rule: 1 Page = 1 Minute
        statBadge.textContent = `Pages: ${estimatedPages} | Est. Runtime: ${estimatedPages}m`;
    }

    // ==========================================================================
    // Title Page Modal Logic
    // ==========================================================================

    const modal = document.getElementById('modal-title-page');
    
    document.getElementById('btn-title-page').addEventListener('click', () => {
        document.getElementById('tp-title').value = titleData.title;
        document.getElementById('tp-author').value = titleData.author;
        document.getElementById('tp-contact').value = titleData.contact;
        modal.classList.remove('hidden');
    });

    document.getElementById('btn-close-modal').addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    document.getElementById('btn-save-title').addEventListener('click', () => {
        titleData.title = document.getElementById('tp-title').value;
        titleData.author = document.getElementById('tp-author').value;
        titleData.contact = document.getElementById('tp-contact').value;
        modal.classList.add('hidden');
    });

    // ==========================================================================
    // File I/O (Saving and Loading .slate files)
    // ==========================================================================

    document.getElementById('btn-save').addEventListener('click', () => {
        const scriptData = editor.getScriptData();
        const payload = { titlePage: titleData, script: scriptData };
        
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const filename = titleData.title ? titleData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'untitled_script';
        a.download = filename + '.slate';
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
                    const parsed = JSON.parse(event.target.result);
                    if (parsed.titlePage) titleData = parsed.titlePage;
                    if (parsed.script) editor.loadScriptData(parsed.script);
                } catch (err) {
                    alert('Error: Invalid or corrupted .slate file.');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // ==========================================================================
    // PDF Export Engine (html2pdf.js)
    // ==========================================================================

    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        // 1. Prepare the hidden Print Container
        printContainer.innerHTML = '';
        
        // 2. Inject Title Page (if data exists)
        if (titleData.title || titleData.author) {
            const tpDiv = document.createElement('div');
            tpDiv.style.height = '10in'; // Force full page height
            tpDiv.style.display = 'flex';
            tpDiv.style.flexDirection = 'column';
            tpDiv.style.justifyContent = 'center';
            tpDiv.style.alignItems = 'center';
            tpDiv.style.textAlign = 'center';
            tpDiv.style.pageBreakAfter = 'always'; // Force break before script

            tpDiv.innerHTML = `
                <h1 style="font-size: 24pt; text-transform: uppercase; margin-bottom: 24pt;">${titleData.title || 'UNTITLED'}</h1>
                <p style="margin-bottom: 12pt;">written by</p>
                <p>${titleData.author || 'Anonymous'}</p>
                <div style="position: absolute; bottom: 0; left: 0; text-align: left; white-space: pre-wrap; font-size: 12pt;">${titleData.contact || ''}</div>
            `;
            printContainer.appendChild(tpDiv);
        }

        // 3. Clone script blocks for printing
        const blocks = document.querySelectorAll('.script-block');
        blocks.forEach(block => {
            const clone = block.cloneNode(true);
            
            // Strip the drag handles out so they don't print
            const handle = clone.querySelector('.drag-handle');
            if (handle) handle.remove();
            
            printContainer.appendChild(clone);
        });

        // 4. Configure html2pdf parameters
        const opt = {
            margin:       1, // Standard 1-inch margins
            filename:     `${titleData.title || 'script'}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 }, // Higher resolution rendering
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
            pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] } // Prevents cutting lines in half
        };

        // 5. Generate and download
        html2pdf().set(opt).from(printContainer).save().then(() => {
            // Clean up the DOM after rendering
            printContainer.innerHTML = '';
        });
    });

    // Run an initial UI update pass to sync everything
    updateUI();
});
