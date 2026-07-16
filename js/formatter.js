class ScriptFormatter {
    static characterCache = new Set();

    static determineFormat(text, previousFormat = null) {
        const trimmed = text.trim();
        const upper = trimmed.toUpperCase();

        if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(trimmed)) return 'scene';
        if (upper.endsWith(' TO:') || upper === 'FADE OUT.' || upper === 'FADE IN:' || upper.startsWith('FADE ')) return 'transition';
        if (trimmed.startsWith('(') && trimmed.endsWith(')')) return 'parenthetical';
        
        const isAllCaps = (upper === trimmed) && /[a-zA-Z]/.test(trimmed);
        
        if (isAllCaps && trimmed.length < 50 && !trimmed.includes('  ')) {
            if (upper.includes('ANGLE ON') || upper.includes('CLOSE UP') || upper.includes('CU ') || upper.endsWith(' - ')) return 'shot';
            return 'character';
        }

        if (previousFormat === 'character' || previousFormat === 'parenthetical') {
            if (isAllCaps && trimmed.length < 50) return 'character';
            return 'dialogue';
        }

        return 'action';
    }

    static getNextFormat(currentFormat, text) {
        if (currentFormat === 'scene') return 'action';
        if (currentFormat === 'character') return 'dialogue';
        if (currentFormat === 'dialogue') return 'action'; 
        if (currentFormat === 'parenthetical') return 'dialogue';
        if (currentFormat === 'transition') return 'scene';
        return 'action';
    }

    // Passive Validation Scanner
    static validateFormat(format, text) {
        const trimmed = text.trim();
        if (!trimmed) return null;

        if (format === 'character' && trimmed !== trimmed.toUpperCase()) {
            return "Characters should be ALL CAPS.";
        }
        if (format === 'scene' && !/^(INT|EXT|I\/E)/i.test(trimmed)) {
            return "Scene headings typically start with INT. or EXT.";
        }
        if (format === 'action' && /^(INT\.|EXT\.)/i.test(trimmed)) {
            return "This looks like a Scene Heading.";
        }
        if (format === 'parenthetical' && (!trimmed.startsWith('(') || !trimmed.endsWith(')'))) {
            return "Parentheticals should be wrapped in (brackets).";
        }
        return null; // No errors
    }

    static rebuildCharacterCache(blocksData) {
        this.characterCache.clear();
        blocksData.forEach(block => {
            if (block.format === 'character') {
                const name = block.text.trim().replace(/\s*\(.*\)$/, ''); // Strip VO/OS
                if (name) this.characterCache.add(name.toUpperCase());
            }
        });
    }

    static suggestCharacter(partialText) {
        const upperPartial = partialText.trim().toUpperCase();
        if (!upperPartial) return null;
        for (let name of this.characterCache) {
            if (name.startsWith(upperPartial) && name !== upperPartial) return name;
        }
        return null;
    }
}

window.ScriptFormatter = ScriptFormatter;
