/* SimpleSlate — formatter.js (chunk-mode, v1)
   Manual-first formatting helper: guess per-block type with confidence.
   - Pure suggestions (no text mutation, no auto-caps)
   - Confidence-gated to avoid noisy/false prompts
   - Context-aware (prev types), supports learned character names
   - Keeps page/line estimation for stats & exports

   API (window.SimpleSlateFormatter):
     - guessType(line: string, ctx?: { prevType?, prevNonEmptyType?, prevBlank?, knownChars?: string[] })
         -> { type, confidence, alt: [ [type, score], ... ], suggested?: string }
     - learnCharacter(name: string)
     - resetSession()
     - estimateLinesFromBlocks(blocks: {type,text}[])
     - TYPES: string[]
*/

(function () {
  // ---------- utils ----------
  const trim = (s) => (s || "").trim();
  const up = (s) => (s || "").toUpperCase();
  const lettersOnly = (s) => (s || "").replace(/[^A-Za-z]+/g, "");
  const isBlank = (s) => !trim(s);
  const hasLower = (s) => /[a-z]/.test(s || "");
  const hasUpper = (s) => /[A-Z]/.test(s || "");
  const capsRatio = (s) => {
    const t = lettersOnly(s);
    if (!t.length) return 0;
    const upper = (t.match(/[A-Z]/g) || []).length;
    return upper / t.length;
  };
  const isAllCapsLoose = (s) => capsRatio(s) >= 0.9 && /[A-Z]/.test(s || "");

  const TIME_WORD = /\b(DAY|NIGHT|MORNING|EVENING|AFTERNOON|LATER|CONTINUOUS|SUNSET|SUNRISE|DAWN|DUSK)\b/i;
  const SCENE_PREFIX_STRICT = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.|EST\.)\b/; // NOTE: expects uppercase
  const TRANSITIONS = new Set([
    "CUT TO:", "SMASH CUT TO:", "MATCH CUT TO:", "DISSOLVE TO:",
    "FADE IN:", "FADE OUT:", "FADE OUT.", "WIPE TO:", "IRIS OUT:"
  ]);
  const SHOT_RX = [
    /^ANGLE ON:/i, /^CLOSE ON:/i, /^WIDE ON:/i, /^INSERT:/i,
    /^POV:?$/i, /^MONTAGE\b/i, /^SERIES OF SHOTS\b/i, /ON:$/i
  ];

  // ---------- session memory for character learning ----------
  const session = {
    chars: new Set(),
  };
  function normCharKey(s) {
    if (!s) return "";
    let t = trim(s).replace(/\s+\((V\.O\.|O\.S\.|CONT'D)\)\s*$/i, "");
    t = t.replace(/\^\s*$/, "");
    t = t.replace(/\s+/g, " ");
    return up(t);
  }
  function learnCharacter(name) { session.chars.add(normCharKey(name)); }
  function resetSession() { session.chars.clear(); }

  // ---------- scoring helpers ----------
  const hasDashSplit = (s) => /\s-\s/.test(s);

  function scoreScene(line, ctx) {
    const raw = trim(line);
    if (!raw) return 0;
    const U = up(raw);
    let sc = 0;
    if (SCENE_PREFIX_STRICT.test(U)) sc += 6;           // must be uppercase INT./EXT./INT/EXT/I/E/EST.
    if (isAllCapsLoose(raw) && hasDashSplit(raw)) sc += 4; // ALL CAPS with " - " (LOCATION - TIME)
    if (TIME_WORD.test(U)) sc += 2;
    if (ctx.prevBlank) sc += 1;
    if (ctx.prevNonEmptyType === "scene" || ctx.prevNonEmptyType === "action") sc += 1;
    if (!isAllCapsLoose(raw) && !SCENE_PREFIX_STRICT.test(U)) sc -= 4; // lowercase "int. walmart" → penalize
    return sc;
  }

  function scoreTransition(line) {
    const U = up(trim(line));
    if (!U) return 0;
    let sc = 0;
    if (TRANSITIONS.has(U)) sc += 7;
    if (/:$/.test(U) && isAllCapsLoose(U)) sc += 4; // ANYTHING TO:
    return sc;
  }

  function scoreShot(line) {
    const U = up(trim(line));
    if (!U) return 0;
    let sc = 0;
    for (const rx of SHOT_RX) if (rx.test(U)) { sc += 6; break; }
    if (isAllCapsLoose(U)) sc += 1;
    return sc;
  }

  function scoreCharacter(line, ctx) {
    const raw = trim(line);
    if (!raw) return 0;
    if (/TO:\s*$/.test(up(raw))) return 0;      // CUT TO:
    if (raw.length > 32) return 0;
    let sc = 0;
    if (isAllCapsLoose(raw)) sc += 6;           // cues are all-caps
    if (/^\w[\w\s.'\-()]+$/.test(raw)) sc += 1; // human-ish
    if (ctx.knownChars.has(normCharKey(raw))) sc += 2;
    if (/\^\s*$/.test(raw)) sc += 1;            // dual caret
    return sc;
  }

  function scoreParenthetical(line, ctx) {
    const t = trim(line);
    if (!t) return 0;
    if (!/^\(.*\)$/.test(t)) return 0;
    const under = ["character","dialogue","parenthetical"].includes(ctx.prevNonEmptyType);
    return (under ? 4 : 1) + (t.length <= 60 ? 1 : 0);
  }

  const looksCentered = (s) => /^>.*<$/.test(trim(s));
  const looksLyric    = (s) => /^(\~|♪)\s*/.test(trim(s));

  // Convert absolute scores to a pseudo-confidence [0,1]
  function toConfidence(best, totals) {
    const max = Math.max(1, totals.reduce((a, b) => Math.max(a, b), 0));
    // Slight softness to avoid 1.0 spikes
    return Math.min(0.99, Math.max(0, best / (max + 2)));
  }

  // ---------- main guess ----------
  function guessType(line, ctx = {}) {
    const t = trim(line);
    if (!t) return { type: "action", confidence: 0.0, alt: [["action", 0]] };

    // shallow quick detections (do not force)
    if (t === "--") return { type: "divider", confidence: 0.95, alt: [["divider", 0.95], ["action", 0.2]] };
    if (looksCentered(t)) return { type: "centered", confidence: 0.8, alt: [["centered",0.8], ["action",0.3]] };
    if (looksLyric(t)) return { type: "lyric", confidence: 0.75, alt: [["lyric",0.75], ["dialogue",0.45], ["action",0.3]] };

    const prevType = ctx.prevType || "action";
    const prevNE   = ctx.prevNonEmptyType || "action";
    const prevBlank = !!ctx.prevBlank;
    const knownChars = new Set([...(ctx.knownChars || []), ...session.chars]);

    const sScene  = scoreScene(t, { prevBlank, prevNonEmptyType: prevNE });
    const sTrans  = scoreTransition(t);
    const sShot   = scoreShot(t);
    const sChar   = scoreCharacter(t, { knownChars });
    const sParen  = scoreParenthetical(t, { prevNonEmptyType: prevNE });

    // Dialogue flow is not scored directly; it's a contextual fallback
    const candidates = [
      ["scene", sScene],
      ["transition", sTrans],
      ["shot", sShot],
      ["character", sChar],
      ["parenthetical", sParen],
      // dialogue/action handled post
    ];

    // Pick best explicit type above minimal threshold
    const sorted = candidates.slice().sort((a,b)=>b[1]-a[1]);
    const best = sorted[0];
    const totals = candidates.map(c=>c[1]);

    // Hard thresholds to avoid noise
    const pass = (name, score) => {
      switch (name) {
        case "scene":        return score >= 7;
        case "transition":   return score >= 7;
        case "shot":         return score >= 6;
        case "character":    return score >= 7;
        case "parenthetical":return score >= 5;
        default: return false;
      }
    };

    if (best && pass(best[0], best[1])) {
      // build alt list for UI (optional)
      const alt = sorted.map(([k, s]) => [k, Math.round(s * 100) / 100]);
      // optional suggested normalized string (non-mutating)
      let suggested;
      if (best[0] === "character") {
        // normalize suffix spacing while preserving actual text (just a suggestion)
        suggested = up(t).replace(/\s+\((V\.O\.|O\.S\.|CONT'D)\)\s*$/i, " ($1)");
      }
      if (best[0] === "scene") {
        suggested = up(t).replace(/\s*-\s*/g, " - ");
      }
      // learn characters only when we’re confident
      if (best[0] === "character") learnCharacter(t);

      return {
        type: best[0],
        confidence: toConfidence(best[1], totals),
        alt,
        ...(suggested && { suggested })
      };
    }

    // Contextual dialogue fallback
    if (["character","parenthetical","dialogue"].includes(prevNE)) {
      const alt = [["dialogue", 0.6], ["action", 0.4]];
      return { type: "dialogue", confidence: 0.6, alt };
    }

    // Otherwise action-safe
    const alt = sorted.map(([k, s]) => [k, Math.round(s * 100) / 100]);
    return { type: "action", confidence: 0.45, alt: alt.length ? alt : [["action", 0.45]] };
  }

  // ---------- stats (for bottom bar) ----------
  function estimateLinesFromBlocks(blocks) {
    const CPL = 62;
    let lines = 0;
    for (const b of (blocks || [])) {
      const text = b?.text || "";
      if (isBlank(text)) { lines += 1; continue; }
      let wf = 1.0;
      switch (b.type) {
        case "dialogue": wf = 0.74; break;
        case "character": wf = 0.5; break;
        case "parenthetical": wf = 0.82; break;
        case "transition": wf = 0.6; break;
        case "centered": wf = 0.9; break;
      }
      const chars = text.split("\n").reduce((a,ln)=>a+(ln.length||1),0);
      const est = Math.max(1, Math.ceil((chars / CPL) / wf));
      lines += est + 1;
    }
    return lines;
  }

  // ---------- export ----------
  window.SimpleSlateFormatter = {
    guessType,
    learnCharacter,
    resetSession,
    estimateLinesFromBlocks,
    TYPES: ["scene","action","character","parenthetical","dialogue","transition","shot","divider","centered","lyric","note"]
  };
})();
