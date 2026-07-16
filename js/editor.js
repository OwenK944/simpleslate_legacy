class Editor {
    constructor() {
        this.canvas = document.getElementById('script-canvas');
        this.addZone = document.getElementById('add-block-zone');
        this.draggedBlock = null;
        this.init();
    }

    init() {
        this.setupDelegatedEvents();
        this.setupDragAndDrop();
        this.setupAddZone();
    }

    createBlockElement(format, content = '') {
        const wrapper = document.createElement('div');
        wrapper.className = `script-block format-${format}`;
        wrapper.dataset.format = format;
        wrapper.draggable = true;

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
    }

    setupDelegatedEvents() {
        this.canvas.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('block-content')) return;
            
            const currentBlock = e.target.closest('.script-block');
            const currentFormat = currentBlock.dataset.format;
            const text = e.target.textContent;

            if (e.key === 'Enter') {
                e.preventDefault(); 
                // Only evaluate the format when the user hits Enter (fixes the jitter)
                const determinedFormat = ScriptFormatter.determineFormat(text, currentBlock.previousElementSibling?.dataset.format);
                this.changeFormat(currentBlock, determinedFormat);
                
                // Spawn next block
                const nextFormat = ScriptFormatter.getNextFormat(determinedFormat, text);
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
                }
            }
        });
    }

    setupAddZone() {
        this.addZone.contentEditable = 'true';
        this.addZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = this.addZone.textContent;
                if (text.trim() === '') return;
                
                const lastBlock = this.canvas.lastElementChild;
                const format = ScriptFormatter.determineFormat(text, lastBlock?.dataset.format);
                
                this.addBlock(format, text);
                this.addZone.textContent = '';
                
                // Scroll to bottom
                document.getElementById('canvas-container').scrollTop = document.getElementById('canvas-container').scrollHeight;
            }
        });
    }

    setupDragAndDrop() {
        this.canvas.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('script-block')) {
                this.draggedBlock = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
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
