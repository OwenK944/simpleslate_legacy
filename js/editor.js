/* SimpleSlate — editor.js (chunk-mode, v3.2)
   NEW:
   - Active chip highlight updates whenever draft mode changes
   - (keeps) drag reorder, Alt+↑/↓, retag via chips, suggestions
*/

(function () {
  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const blocksBox = () => $("blocks");
  const draftEl   = () => $("draft");
  const modebar   = () => $("modebar");

  // ---------- Config / State ----------
  const SUGGESTION_THRESHOLD = 0.60;
  const VALID_TYPES = ["scene","action","character","parenthetical","dialogue","transition","shot","divider","centered","lyric","note"];

  let onBlocksChange = null;
  let blocks = [];               // [{ id, type, text, dismissed:Set<string> }]
  let currentMode = "action";
  let uidCounter = 0;

  // Drag state
  let drag = null; // { srcIdx, srcEl, startY, placeholder }

  // ---------- Utilities ----------
  function genId() {
    uidCounter = (uidCounter + 1) % 1_000_000;
    return `b_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
  }
  const esc = (s) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const htmlFromText = (t) => esc(t).replace(/\n/g, "<br>");
  function textFromHTML(node) {
    const html = node.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/g, " ");
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || "").replace(/\r\n?/g, "\n");
  }
  function setBlockClass(p, type) {
    const keep = Array.from(p.classList).filter(c => c === "block" || c === "draft");
    p.className = [...keep, `block-${type}`].join(" ");
    p.dataset.type = type;
  }
  function typeLabel(t) {
    switch (t) {
      case "scene": return "Scene";
      case "action": return "Action";
      case "character": return "Character";
      case "parenthetical": return "Parenthetical";
      case "dialogue": return "Dialogue";
      case "transition": return "Transition";
      case "shot": return "Shot";
      case "divider": return "Divider";
      case "centered": return "Centered";
      case "lyric": return "Lyric";
      default: return t;
    }
  }
  function knownCharactersFromBlocks() {
    const set = new Set();
    for (const b of blocks) {
      if (b.type === "character") {
        const key = (b.text || "")
          .trim()
          .replace(/\s+\((V\.O\.|O\.S\.|CONT'D)\)\s*$/i, "")
          .replace(/\^\s*$/, "")
          .replace(/\s+/g, " ")
          .toUpperCase();
        if (key) set.add(key);
      }
    }
    return set;
  }
  function prevContextForIndex(i) {
    let prevNonEmptyType = "action";
    let prevBlank = true;
    if (i > 0) {
      const prev = blocks[i - 1];
      prevBlank = !(prev && (prev.text || "").trim().length);
      for (let j = i - 1; j >= 0; j--) {
        if ((blocks[j].text || "").trim().length) { prevNonEmptyType = blocks[j].type || "action"; break; }
      }
    }
    return { prevNonEmptyType, prevBlank, prevType: i > 0 ? blocks[i-1].type : "action" };
  }

  // ---------- Rendering ----------
  function renderBlockWrap(block) {
    const wrap = document.createElement("div");
    wrap.className = "block-wrap";
    wrap.dataset.id = block.id;

    const gutter = document.createElement("div");
    gutter.className = "block-gutter"; // left suggestion tab mount

    const content = document.createElement("div");
    content.className = "block-content";

    if (block.type === "divider") {
      const hr = document.createElement("hr");
      hr.className = "block-divider";
      hr.setAttribute("aria-hidden", "true");
      content.appendChild(hr);
    } else {
      const p = document.createElement("p");
      p.className = `block block-${block.type}`;
      p.dataset.type = block.type;
      p.contentEditable = "true";
      p.innerHTML = htmlFromText(block.text || "");
      content.appendChild(p);
    }

    const menu = document.createElement("div");
    menu.className = "block-menu";
    menu.innerHTML = `
      <button class="menu-btn add-after" title="Insert new chunk after">+</button>
      <button class="menu-btn delete" title="Delete this chunk">🗑</button>
    `;

    wrap.appendChild(gutter);
    wrap.appendChild(content);
    wrap.appendChild(menu);
    return wrap;
  }

  function insertBlockDOM(block, afterWrap = null) {
    const node = renderBlockWrap(block);
    if (afterWrap && afterWrap.parentNode) {
      afterWrap.parentNode.insertBefore(node, afterWrap.nextSibling);
    } else {
      blocksBox().appendChild(node);
    }
    return node;
  }

  const findWrapById = (id) => blocksBox().querySelector(`.block-wrap[data-id="${id}"]`);
  const findPInWrap  = (wrap) => wrap?.querySelector(".block-content > .block");

  function clearSuggestionPill(wrap) {
    if (!wrap) return;
    const pill = wrap.querySelector(".suggestion-pill");
    if (pill) pill.remove();
    wrap.classList.remove("has-suggestion"); // stops gutter from intercepting clicks
  }

  function showSuggestionPill(block, guess) {
    const wrap = findWrapById(block.id);
    if (!wrap) return;
    clearSuggestionPill(wrap);

    const gutter = wrap.querySelector(".block-gutter");
    if (!gutter) return;

    wrap.classList.add("has-suggestion");

    const pill = document.createElement("div");
    pill.className = "suggestion-pill";
    pill.dataset.blockId = block.id;
    pill.dataset.suggestType = guess.type;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `Looks like ${typeLabel(guess.type)}`;

    const yes = document.createElement("button");
    yes.className = "btn-icon btn-yes";
    yes.title = `Change to ${typeLabel(guess.type)}`;
    const yesIcon = document.createElement("span");
    yesIcon.className = "icon-yes";
    yes.appendChild(yesIcon);

    const no = document.createElement("button");
    no.className = "btn-icon btn-no";
    no.title = "Dismiss suggestion";
    const noIcon = document.createElement("span");
    noIcon.className = "icon-no";
    no.appendChild(noIcon);

    pill.appendChild(label);
    pill.appendChild(yes);
    pill.appendChild(no);
    gutter.appendChild(pill);
  }

  // ---------- Suggestions ----------
  function maybeSuggestForBlock(index) {
    const blk = blocks[index];
    if (!blk) return;
    if (blk.type === "divider") { clearSuggestionPill(findWrapById(blk.id)); return; }

    const wrap = findWrapById(blk.id);
    if (!wrap) return;

    const p = findPInWrap(wrap);
    if (!p) return;

    const text = textFromHTML(p);
    blk.text = text;

    if (!text.trim()) { clearSuggestionPill(wrap); return; }

    const knownChars = knownCharactersFromBlocks();
    const ctx = { ...prevContextForIndex(index), knownChars };
    const g = window.SimpleSlateFormatter.guessType(text, ctx);

    if (!g) { clearSuggestionPill(wrap); return; }
    if (g.type === blk.type) { clearSuggestionPill(wrap); return; }
    if ((g.confidence ?? 0) < SUGGESTION_THRESHOLD) { clearSuggestionPill(wrap); return; }
    if (blk.dismissed && blk.dismissed.has(g.type)) { clearSuggestionPill(wrap); return; }

    showSuggestionPill(blk, g);
  }

  // ---------- Draft flow ----------
  function updateDraftPlaceholder() {
    const placeholders = {
      scene: "SCENE HEADING (e.g., INT. KITCHEN - NIGHT) — Enter to finalize",
      action: "Describe action… — Enter to finalize",
      character: "CHARACTER NAME — Enter to finalize",
      dialogue: "Dialogue… — Enter to finalize",
      parenthetical: "(whispering) — Enter to finalize",
      transition: "CUT TO: — Enter to finalize",
      shot: "CLOSE ON: — Enter to finalize",
      divider: "Press Enter to insert a divider",
      centered: "Centered line… — Enter to finalize",
      lyric: "♪ lyrics here — Enter to finalize",
      note: "[[note]] — Enter to finalize"
    };
    draftEl().setAttribute("data-placeholder", placeholders[currentMode] || "Type… then Enter");
  }

  // ---- NEW: toggle active chip
  function updateActiveChip(mode) {
    const chips = modebar().querySelectorAll('.mode-chip');
    chips.forEach(ch => ch.classList.toggle('is-active', ch.dataset.mode === mode));
  }

  function setMode(mode) {
    if (!VALID_TYPES.includes(mode)) mode = "action";
    currentMode = mode;
    setBlockClass(draftEl(), mode);
    updateDraftPlaceholder();
    updateActiveChip(mode); // <-- highlight fix
  }
  const getMode = () => currentMode;

  function focusDraft() {
    const d = draftEl();
    d.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(d);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function finalizeDraft() {
    const d = draftEl();

    if (currentMode === "divider") {
      const blk = { id: genId(), type: "divider", text: "", dismissed: new Set() };
      blocks.push(blk);
      insertBlockDOM(blk);
      notifyChange();
      return;
    }

    const text = textFromHTML(d);
    if (!text.trim()) return;

    const blk = { id: genId(), type: currentMode, text, dismissed: new Set() };
    blocks.push(blk);
    insertBlockDOM(blk);

    d.innerHTML = "";

    maybeSuggestForBlock(blocks.length - 1);

    notifyChange();
    focusDraft();
  }

  // ---------- Retag current block via chips ----------
  function getCaretBlockIndex() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return -1;
    const node = sel.anchorNode;
    if (!node) return -1;
    const wrap = node.nodeType === 1
      ? node.closest(".block-wrap")
      : (node.parentElement && node.parentElement.closest(".block-wrap"));
    if (!wrap) return -1;
    const id = wrap.dataset.id;
    return blocks.findIndex(b => b.id === id);
  }

  function retagBlockAt(index, newType) {
    if (index < 0 || index >= blocks.length) return;
    const blk = blocks[index];
    if (!VALID_TYPES.includes(newType)) return;
    if (blk.type === newType) return;

    blk.type = newType;
    blk.dismissed = new Set();

    const wrap = findWrapById(blk.id);
    const p = findPInWrap(wrap);
    if (p) setBlockClass(p, blk.type);

    clearSuggestionPill(wrap);
    if (blk.type === "character") window.SimpleSlateFormatter.learnCharacter(blk.text);

    notifyChange();
  }

  // ---------- Right-side menu actions ----------
  function insertAfter(idx) {
    const afterWrap = findWrapById(blocks[idx].id);
    const newBlk = { id: genId(), type: currentMode, text: "", dismissed: new Set() };
    blocks.splice(idx + 1, 0, newBlk);
    const node = insertBlockDOM(newBlk, afterWrap);

    const p = findPInWrap(node);
    if (p) {
      p.focus();
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    notifyChange();
  }

  function deleteAt(idx) {
    const id = blocks[idx].id;
    const wrap = findWrapById(id);
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    blocks.splice(idx, 1);
    notifyChange();
  }

  // ---------- Drag & Drop Reordering ----------
  function startDrag(wrap, e) {
    const id = wrap.dataset.id;
    const srcIdx = blocks.findIndex(b => b.id === id);
    if (srcIdx < 0) return;

    const rect = wrap.getBoundingClientRect();
    const ph = document.createElement("div");
    ph.className = "block-placeholder";
    ph.style.height = rect.height + "px";
    ph.style.marginTop = getComputedStyle(wrap).marginTop;
    ph.style.border = "1px dashed rgba(120,176,255,.5)";
    ph.style.borderRadius = "8px";
    ph.style.opacity = "0.6";

    wrap.parentNode.insertBefore(ph, wrap.nextSibling);

    wrap.style.position = "relative";
    wrap.style.zIndex = "10";
    wrap.style.pointerEvents = "none";
    wrap.style.opacity = "0.72";

    const startY = e.clientY;

    function onMove(ev) {
      const dy = ev.clientY - startY;
      wrap.style.transform = `translateY(${dy}px)`;

      const siblings = Array.from(blocksBox().querySelectorAll(".block-wrap")).filter(w => w !== wrap);
      let target = null;
      for (const s of siblings) {
        const r = s.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (ev.clientY < mid) { target = s; break; }
      }
      if (target) {
        blocksBox().insertBefore(ph, target);
      } else {
        blocksBox().appendChild(ph);
      }
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      wrap.style.position = "";
      wrap.style.zIndex = "";
      wrap.style.pointerEvents = "";
      wrap.style.opacity = "";
      wrap.style.transform = "";

      if (ph.parentNode) {
        ph.parentNode.insertBefore(wrap, ph);
        ph.parentNode.removeChild(ph);
      }

      const orderedIds = Array.from(blocksBox().querySelectorAll(".block-wrap")).map(n => n.dataset.id);
      blocks.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

      notifyChange();
      drag = null;
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    drag = { srcIdx, srcEl: wrap, placeholder: ph, startY };
  }

  function moveBlockByKey(delta) {
    const idx = getCaretBlockIndex();
    if (idx < 0) return;
    const newIdx = Math.max(0, Math.min(blocks.length - 1, idx + delta));
    if (newIdx === idx) return;

    const wrap = findWrapById(blocks[idx].id);
    const refWrap = findWrapById(blocks[newIdx].id);

    if (newIdx > idx) {
      refWrap.parentNode.insertBefore(wrap, refWrap.nextSibling);
    } else {
      refWrap.parentNode.insertBefore(wrap, refWrap);
    }

    const item = blocks.splice(idx, 1)[0];
    blocks.splice(newIdx, 0, item);
    notifyChange();

    const p = findPInWrap(wrap);
    if (p) p.focus();
  }

  // ---------- Modebar & events ----------
  function bindModebar() {
    // Click: retag block under caret OR set draft mode if caret is in draft
    modebar().addEventListener("click", (e) => {
      const btn = e.target.closest(".mode-chip");
      if (!btn) return;
      const mode = btn.dataset.mode;
      const idx = getCaretBlockIndex();
      const sel = window.getSelection();
      const inDraft = sel && sel.anchorNode && (sel.anchorNode === draftEl() || draftEl().contains(sel.anchorNode));

      if (idx >= 0 && !inDraft) {
        // Retag current block (do not change draft mode/highlight)
        retagBlockAt(idx, mode);
        const wrap = findWrapById(blocks[idx].id);
        const p = findPInWrap(wrap);
        if (p) p.focus();
      } else {
        // Change draft mode + highlight
        setMode(mode);
        draftEl().focus();
      }
    });

    // Alt+1..7, Alt+- switch draft mode (also updates highlight via setMode)
    document.addEventListener("keydown", (e) => {
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const map = { "1":"scene","2":"action","3":"character","4":"dialogue","5":"parenthetical","6":"transition","7":"shot","-":"divider" };
        const m = map[e.key];
        if (m) { e.preventDefault(); setMode(m); draftEl().focus(); }
      }
    });

    // Alt+ArrowUp/Down move current block
    document.addEventListener("keydown", (e) => {
      if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowUp") { e.preventDefault(); moveBlockByKey(-1); }
      if (e.key === "ArrowDown") { e.preventDefault(); moveBlockByKey(1); }
    });

    // Ensure initial highlight matches initial mode
    updateActiveChip(currentMode);
  }

  function bindDraft() {
    const d = draftEl();
    d.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finalizeDraft();
      }
    });
  }

  function bindBlocksEvents() {
    const box = blocksBox();

    // Suggestion accept/dismiss
    box.addEventListener("click", (e) => {
      const pill = e.target.closest(".suggestion-pill");
      if (!pill) return;

      const id = pill.dataset.blockId;
      const suggestType = pill.dataset.suggestType;
      const idx = blocks.findIndex(b => b.id === id);
      if (idx < 0) return;

      const yes = e.target.closest(".btn-yes");
      const no  = e.target.closest(".btn-no");

      const wrap = findWrapById(id);

      if (yes) {
        const p = findPInWrap(wrap);
        const blk = blocks[idx];
        blk.type = suggestType;
        blk.dismissed = new Set();
        if (p) setBlockClass(p, blk.type);
        clearSuggestionPill(wrap);
        if (blk.type === "character") window.SimpleSlateFormatter.learnCharacter(blk.text);
        notifyChange();
        return;
      }
      if (no) {
        const blk = blocks[idx];
        if (!blk.dismissed) blk.dismissed = new Set();
        blk.dismissed.add(suggestType);
        clearSuggestionPill(wrap);
        notifyChange();
        return;
      }
    });

    // Right-side menu: insert-after / delete (delegated)
    box.addEventListener("click", (e) => {
      const btnAdd = e.target.closest(".block-menu .add-after");
      const btnDel = e.target.closest(".block-menu .delete");
      if (!btnAdd && !btnDel) return;

      const wrap = e.target.closest(".block-wrap");
      const id = wrap?.dataset.id;
      const idx = blocks.findIndex(b => b.id === id);
      if (idx < 0) return;

      if (btnAdd) { insertAfter(idx); return; }
      if (btnDel) {
        deleteAt(idx);
        const next = blocks[idx] ? findWrapById(blocks[idx].id) : null;
        const prev = blocks[idx-1] ? findWrapById(blocks[idx-1].id) : null;
        const target = (next || prev);
        const p = target ? findPInWrap(target) : null;
        if (p) { p.focus(); } else { draftEl().focus(); }
        return;
      }
    });

    // Re-guess on content edits (debounced)
    let t;
    box.addEventListener("input", (e) => {
      const p = e.target.closest(".block-content > .block");
      if (!p) return;
      clearTimeout(t);
      t = setTimeout(() => {
        const wrap = p.closest(".block-wrap");
        const id = wrap?.dataset.id;
        const idx = blocks.findIndex(b => b.id === id);
        if (idx < 0) return;

        blocks[idx].text = textFromHTML(p);
        maybeSuggestForBlock(idx);
        notifyChange();
      }, 140);
    });

    // ----- Drag & Drop start -----
    box.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // left click only
      if (e.target.closest(".block-menu")) return;         // don't drag from right tab
      if (e.target.closest(".suggestion-pill")) return;    // don't drag from left pill
      if (e.target.closest(".block-content > .block")) return; // don't drag from editable text

      const wrap = e.target.closest(".block-wrap");
      if (!wrap) return;

      e.preventDefault();
      startDrag(wrap, e);
    });
  }

  // ---------- API plumbing ----------
  function notifyChange() {
    if (!onBlocksChange) return;
    const serializable = blocks.map(b => ({
      id: b.id,
      type: b.type,
      text: b.text,
      dismissed: Array.from(b.dismissed || [])
    }));
    onBlocksChange(serializable);
  }

  function setBlocks(newBlocks) {
    clearAll();
    for (const b of (newBlocks || [])) {
      const blk = {
        id: b.id || genId(),
        type: VALID_TYPES.includes(b.type) ? b.type : "action",
        text: b.text || "",
        dismissed: new Set(b.dismissed || [])
      };
      blocks.push(blk);
      insertBlockDOM(blk);
    }
    notifyChange();
    focusDraft();
    updateActiveChip(currentMode);
  }

  function getBlocks() {
    return blocks.map(b => ({
      id: b.id, type: b.type, text: b.text, dismissed: Array.from(b.dismissed || [])
    }));
  }

  function clearAll() {
    blocks = [];
    blocksBox().innerHTML = "";
    draftEl().innerHTML = "";
  }

  function init(opts = {}) {
    onBlocksChange = typeof opts.onBlocksChange === "function" ? opts.onBlocksChange : null;
    window.SimpleSlateFormatter.resetSession?.();

    bindModebar();
    bindDraft();
    bindBlocksEvents();

    setMode("action"); // also updates chip highlight
    focusDraft();
  }

  // Expose
  window.SimpleSlateEditor = {
    init, getBlocks, setBlocks, setMode, getMode, focusDraft, clearAll
  };
})();
