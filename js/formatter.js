class ScriptFormatter {
    /**
     * Instantly determines the block format based on standard screenplay mechanics.
     * @param {string} text - The current text in the block.
     * @param {string} previousFormat - The format of the block immediately preceding this one.
     * @returns {string} - The calculated format type.
     */
    static determineFormat(text, previousFormat = null) {
        const trimmed = text.trim();
        const upper = trimmed.toUpperCase();

        // 1. Scene Headings
        if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(trimmed)) {
            return 'scene';
        }

        // 2. Transitions
        if (upper.endsWith(' TO:') || upper === 'FADE OUT.' || upper === 'FADE IN:' || upper.startsWith('FADE ')) {
            return 'transition';
        }

        // 3. Parentheticals
        if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
            return 'parenthetical';
        }

        // 4. Characters
        // Must be entirely uppercase, contain letters, and be relatively short to avoid formatting shouting action as a character.
        const isAllCaps = (upper === trimmed) && /[A-Z]/.test(trimmed);
        
        if (isAllCaps && trimmed.length < 50 && !trimmed.includes('  ')) {
            // Guard against common shot directions being misidentified as characters
            if (upper.includes('ANGLE ON') || upper.includes('CLOSE UP') || upper.includes('CU ') || upper.endsWith(' - ')) {
                return 'shot';
            }
            return 'character';
        }

        // 5. Dialogue
        // If the line above it is a Character or a Parenthetical, standard flow dictates this is Dialogue.
        if (previousFormat === 'character' || previousFormat === 'parenthetical') {
            if (isAllCaps && trimmed.length < 50) return 'character'; // Catch back-to-back character changes
            return 'dialogue';
        }

        // If it meets none of the strict criteria, it is standard Action.
        return 'action';
    }

    /**
     * Determines what the NEXT block should default to when hitting "Enter".
     */
    static getNextFormat(currentFormat, text) {
        if (currentFormat === 'scene') return 'action';
        if (currentFormat === 'character') return 'dialogue';
        if (currentFormat === 'dialogue') return 'action'; 
        if (currentFormat === 'parenthetical') return 'dialogue';
        if (currentFormat === 'transition') return 'scene';
        return 'action';
    }
}
