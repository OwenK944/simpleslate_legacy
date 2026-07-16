class Editor {
    constructor() {
        this.canvas = document.getElementById('script-canvas');
        this.init();
    }

    init() {
        this.canvas.innerHTML = '';
        // Instantiate the workspace with a starting scene heading
        this.addBlock('scene', 'EXT. ');
        this.setupDelegatedEvents();
    }

    createBlockElement(format, content = '') {
        const wrapper = document.createElement('div');
        wrapper.className = `script-block format-${format}`;
        wrapper.dataset.format = format;

        const handle = document.createElement('div');
        handle.className = 'drag-handle';
        handle.innerHTML = '⋮⋮';
        handle.contentEditable = 'false';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'block-content';
        contentDiv.contentEditable = 'true';
        contentDiv.textContent = content;

        wrapper.appendChild(handle);
        wrapper.appendChild(contentDiv);
        return wrapper;
    }

    addBlock(format, content = '', insertAfterBlock = null) {
        const block = this.createBlockElement(format, content);
        if (insertAfterBlock && insertAfterBlock.nextSibling) {
            this.canvas.insertBefore(block, insertAfterBlock.nextSibling);
        } else {
            this.canvas.appendChild(block);
        }
        this.focusBlock(block);
        return block;
    }

    focusBlock(block, atEnd = true) {
        const contentDiv = block.querySelector('.block-content');
        contentDiv.focus();
        if (atEnd && contentDiv.textContent.length > 0) {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(contentDiv);
            range.collapse(false); // False drops the cursor at the end of the text
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    setupDelegatedEvents() {
        // Handle Structural Navigation (Enter, Backspace, Arrows)
        this.canvas.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('block-content')) return;
            
            const currentBlock = e.target.closest('.script-block');
            const currentFormat = currentBlock.dataset.format;
            const text = e.target.textContent;

            // ENTER: Spawn a new block based on standard flow
            if (e.key === 'Enter') {
                e.preventDefault(); 
                const nextFormat = ScriptFormatter.getNextFormat(currentFormat, text);
                this.addBlock(nextFormat, '', currentBlock);
                window.dispatchEvent(new Event('scriptChanged'));
            }

            // BACKSPACE: Delete block if empty and merge focus upward
            if (e.key === 'Backspace') {
                if (e.target.textContent === '') {
                    e.preventDefault();
                    const prevBlock = currentBlock.previousElementSibling;
                    if (prevBlock) {
                        currentBlock.remove();
                        this.focusBlock(prevBlock);
                        window.dispatchEvent(new Event('scriptChanged'));
                    }
                }
            }

            // ARROW UP: Fluid vertical navigation
            if (e.key === 'ArrowUp') {
                const prevBlock = currentBlock.previousElementSibling;
                if (prevBlock) {
                    e.preventDefault();
                    this.focusBlock(prevBlock);
                }
            }

            // ARROW DOWN: Fluid vertical navigation
            if (e.key === 'ArrowDown') {
                const nextBlock = currentBlock.nextElementSibling;
                if (nextBlock) {
                    e.preventDefault();
                    this.focusBlock(nextBlock);
                }
            }
        });

        // Handle Real-Time Formatting (State Machine trigger)
        this.canvas.addEventListener('keyup', (e) => {
            if (!e.target.classList.contains('block-content')) return;
            
            // Bypass logic for navigation keys to prevent unnecessary processing
            if (['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

            const currentBlock = e.target.closest('.script-block');
            const text = e.target.textContent;
            
            const prevBlock = currentBlock.previousElementSibling;
            const prevFormat = prevBlock ? prevBlock.dataset.format : null;

            const newFormat = ScriptFormatter.determineFormat(text, prevFormat);
            
            // Update UI instantly if the format state changes
            if (newFormat !== currentBlock.dataset.format) {
                currentBlock.className = `script-block format-${newFormat}`;
                currentBlock.dataset.format = newFormat;
                window.dispatchEvent(new Event('scriptChanged'));
            }
        });
    }

    // Used by app.js for saving/loading
    getScriptData() {
        const blocks = Array.from(this.canvas.querySelectorAll('.script-block'));
        return blocks.map(b => ({
            format: b.dataset.format,
            text: b.querySelector('.block-content').textContent
        }));
    }

    loadScriptData(data) {
        this.canvas.innerHTML = '';
        data.forEach(item => this.addBlock(item.format, item.text));
        if (this.canvas.firstElementChild) {
            this.focusBlock(this.canvas.firstElementChild);
        }
        window.dispatchEvent(new Event('scriptChanged'));
    }
}

// Bind to global scope for instantiation
window.ScriptEditor = Editor;
