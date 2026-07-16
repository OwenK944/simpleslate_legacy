class Editor {
    constructor() {
        this.canvas = document.getElementById('script-canvas');
        this.addZone = document.getElementById('add-block-zone');
        this.blockRail = document.getElementById('block-rail');
        this.formatHint = document.getElementById('format-hint');
        this.cmdPalette = document.getElementById('command-palette');
        
        this.activeBlock = null;
        this.draggedBlock = null;
        
        this.init();
    }

    init() {
        this.setupKeyboardEvents();
        this.setupRailEvents();
        this.setupAddZone();
        this.setupDragAndDrop();
    }

    createBlockElement(format, content = '') {
        const wrapper = document.createElement('div');
        wrapper.className = `script-block format-${format}`;
        wrapper.dataset.format = format;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'block-content';
        contentDiv.contentEditable = 'true';
        contentDiv.textContent = content;

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
        window.dispatchEvent(new Event('scriptChanged'));
        return block;
    }

    focusBlock(block, atEnd = true) {
        const contentDiv = block.querySelector('.block-content');
        contentDiv.focus();
        if (atEnd && contentDiv.textContent.length > 0) {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(contentDiv);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    changeFormat(block, newFormat) {
        if (!block) return;
        block.className = `script-block format-${newFormat}`;
        block.dataset.format = newFormat;
        window.dispatchEvent(new Event('scriptChanged'));
        this.evaluateHint(block);
    }

    setupKeyboardEvents() {
        // Hotkeys for Instant Formatting
        const hotkeys = {
            's': 'scene', 'a': 'action', 'c': 'character', 
            'd': 'dialogue', 'p': 'parenthetical', 't': 'transition', 'h': 'shot'
        };

        this.canvas.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('block-content')) return;
            const currentBlock = e.target.closest('.script-block');
            const text = e.target.textContent;

            // Alt+Hotkey Formatting
            if (e.altKey && hotkeys[e.key.toLowerCase()]) {
                e.preventDefault();
                this.changeFormat(currentBlock, hotkeys[e.key.toLowerCase()]);
                return;
            }

            // Command Palette '/'
            if (e.key === '/') {
                if (text.trim() === '') {
                    e.preventDefault();
                    this.showCommandPalette(currentBlock);
                    return;
                }
            }

            // Autocomplete Character Names via TAB
            if (e.key === 'Tab' && currentBlock.dataset.format === 'character') {
                e.preventDefault();
                const suggestion = window.ScriptFormatter.suggestCharacter(text);
                if (suggestion) {
                    e.target.textContent = suggestion;
                    this.focusBlock(currentBlock);
                    window.dispatchEvent(new Event('scriptChanged'));
                }
                return;
            }

            // Structural Navigation
            if (e.key === 'Enter') {
                e.preventDefault(); 
                this.hideCommandPalette();
                const determinedFormat = window.ScriptFormatter.determineFormat(text, currentBlock.previousElementSibling?.dataset.format);
                this.changeFormat(currentBlock, determinedFormat);
                
                const nextFormat = window.ScriptFormatter.getNextFormat(determinedFormat, text);
                const newBlock = this.addBlock(nextFormat, '', currentBlock);
                this.focusBlock(newBlock);
            }

            if (e.key === 'Backspace' && text === '') {
                e.preventDefault();
                const prevBlock = currentBlock.previousElementSibling;
                if (prevBlock) {
                    currentBlock.remove();
                    this.focusBlock(prevBlock);
                    window.dispatchEvent(new Event('scriptChanged'));
                    this.hideRailAndHint();
                }
            }
        });

        this.canvas.addEventListener('keyup', (e) => {
            if (['Enter', 'Backspace', 'Alt', 'Tab', '/'].includes(e.key)) return;
            const currentBlock = e.target.closest('.script-block');
            if (currentBlock) this.evaluateHint(currentBlock);
            window.dispatchEvent(new Event('scriptChanged')); // Triggers Auto-save
        });

        // Command Palette Logic
        this.cmdPalette.addEventListener('click', (e) => {
            const item = e.target.closest('.cmd-item');
            if (item && this.activeBlock) {
                this.changeFormat(this.activeBlock, item.dataset.format);
                this.hideCommandPalette();
                this.focusBlock(this.activeBlock);
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.cmdPalette.contains(e.target) && !e.target.classList.contains('block-content')) {
                this.hideCommandPalette();
            }
        });
    }

    setupRailEvents() {
        // Track mouse to position rail and hint
        this.canvas.addEventListener('mousemove', (e) => {
            const block = e.target.closest('.script-block');
            if (block && block !== this.draggedBlock) {
                this.activeBlock = block;
                const canvasRect = this.canvas.getBoundingClientRect();
                const blockRect = block.getBoundingClientRect();
                
                const relativeTop = blockRect.top - canvasRect.top + this.canvas.scrollTop;
                
                this.blockRail.style.top = `${relativeTop}px`;
                this.blockRail.classList.remove('hidden');

                this.evaluateHint(block, relativeTop);
            }
        });

        this.canvas.addEventListener('mouseleave', (e) => {
            // Prevent hiding if interacting with rail
            if (e.relatedTarget && !this.blockRail.contains(e.relatedTarget)) {
                // Keep rail active if typing, hide otherwise. Managed by CSS hover primarily, but JS assists.
            }
        });

        // Rail Buttons
        document.getElementById('rail-add').addEventListener('click', () => {
            if (this.activeBlock) {
                const newBlock = this.addBlock('action', '', this.activeBlock);
                this.focusBlock(newBlock);
            }
        });

        document.getElementById('rail-delete').addEventListener('click', () => {
            if (this.activeBlock) {
                const prev = this.activeBlock.previousElementSibling;
                this.activeBlock.remove();
                this.hideRailAndHint();
                if (prev) this.focusBlock(prev);
                window.dispatchEvent(new Event('scriptChanged'));
            }
        });

        // Smart Hint Fix Click
        this.formatHint.addEventListener('click', () => {
            if (this.activeBlock) {
                const text = this.activeBlock.textContent;
                const correctFormat = window.ScriptFormatter.determineFormat(text);
                this.changeFormat(this.activeBlock, correctFormat);
                this.formatHint.classList.add('hidden');
            }
        });
    }

    evaluateHint(block, relativeTop = null) {
        const text = block.textContent;
        const format = block.dataset.format;
        const warning = window.ScriptFormatter.validateFormat(format, text);
        
        if (warning) {
            if (relativeTop === null) {
                const canvasRect = this.canvas.getBoundingClientRect();
                const blockRect = block.getBoundingClientRect();
                relativeTop = blockRect.top - canvasRect.top + this.canvas.scrollTop;
            }
            this.formatHint.style.top = `${relativeTop}px`;
            this.formatHint.title = warning + " (Click to auto-fix)";
            this.formatHint.classList.remove('hidden');
        } else {
            this.formatHint.classList.add('hidden');
        }
    }

    showCommandPalette(block) {
        this.activeBlock = block;
        const canvasRect = this.canvas.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        
        this.cmdPalette.style.top = `${blockRect.bottom - canvasRect.top + this.canvas.scrollTop + 10}px`;
        this.cmdPalette.style.left = `20px`; // Indented slightly
        this.cmdPalette.classList.remove('hidden');
    }

    hideCommandPalette() {
        this.cmdPalette.classList.add('hidden');
    }

    hideRailAndHint() {
        this.blockRail.classList.add('hidden');
        this.formatHint.classList.add('hidden');
    }

    setupAddZone() {
        this.addZone.contentEditable = 'true';
        this.addZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = this.addZone.textContent;
                if (text.trim() === '') return;
                
                const lastBlock = this.canvas.lastElementChild;
                const format = window.ScriptFormatter.determineFormat(text, lastBlock?.dataset.format);
                
                this.addBlock(format, text);
                this.addZone.textContent = '';
                document.getElementById('canvas-container').scrollTop = document.getElementById('canvas-container').scrollHeight;
            }
        });
    }

    setupDragAndDrop() {
        const handle = document.querySelector('.drag-handle');
        
        handle.addEventListener('mousedown', () => {
            if (this.activeBlock) {
                this.activeBlock.draggable = true;
            }
        });

        this.canvas.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('script-block')) {
                this.draggedBlock = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                this.hideRailAndHint();
            }
        });

        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(this.canvas, e.clientY);
            if (this.draggedBlock) {
                if (afterElement == null) {
                    this.canvas.appendChild(this.draggedBlock);
                } else {
                    this.canvas.insertBefore(this.draggedBlock, afterElement);
                }
            }
        });

        this.canvas.addEventListener('dragend', (e) => {
            if (this.draggedBlock) {
                this.draggedBlock.classList.remove('dragging');
                this.draggedBlock.draggable = false;
                this.draggedBlock = null;
                window.dispatchEvent(new Event('scriptChanged'));
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.script-block:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    getScriptData() {
        const blocks = Array.from(this.canvas.querySelectorAll('.script-block'));
        return blocks.map(b => ({
            format: b.dataset.format,
            text: b.querySelector('.block-content').textContent
        }));
    }

    loadScriptData(data) {
        this.canvas.innerHTML = '';
        data.forEach(item => this.addBlock(item.format || 'action', item.text || ''));
        window.dispatchEvent(new Event('scriptChanged'));
    }
}

window.ScriptEditor = Editor;
