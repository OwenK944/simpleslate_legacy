/* SimpleSlate — app.js (chunk-mode, v1)
   Orchestrates:
   - Editor init (manual mode, per-block suggestions)
   - Autosave/restore (v3)
   - Save/Load (.script JSON)
   - Export PDF (print view) & FDX
   - Live page/min stats
*/

(function () {
  const AUTOSAVE_KEY = "simpleslate.autosave.v3";
  const AUTOSAVE_DELAY = 1200;
  const FILENAME_DEFAULT = "script";

  const $ = (id) => document.getElementById(id);

  let autosaveTimer = null;

  const state = {
    blocks: [],     // [{id,type,text,dismissed:[]}]
    lastSavedAt: null,
  };

  // =============== Editor Wiring ===============

  function onBlocksChange(serializableBlocks) {
    state.blocks = serializableBlocks;
    updateStats();
    markDirty();
  }

  function initEditor() {
    if (!window.SimpleSlateEditor) {
      console.error("Editor not found");
      return;
    }
    window.SimpleSlateEditor.init({ onBlocksChange });

    // Try to restore autosave, else start fresh
    if (!restoreAutosave()) {
      // Start with an empty doc; focus draft
      window.SimpleSlateEditor.setMode("action");
      window.SimpleSlateEditor.focusDraft();
      updateStats(); // Page 1, ~1 min
    }
  }

  // =============== Stats ===============

  function getBlocksForStats() {
    // Stats on finalized blocks only (draft excluded for stability)
    return state.blocks || [];
  }

  function updateStats() {
    const blocks = getBlocksForStats();
    const lines = window.SimpleSlateFormatter.estimateLinesFromBlocks(blocks);
    const pages = Math.max(1, Math.round(lines / 55));
    $("pageCount").textContent = `Page ${pages}`;
    $("timeEstimate").textContent = `~${pages} min`;
  }

  // =============== Autosave ===============

  function markDirty() {
    $("autosaveStatus").textContent = "Saving…";
    scheduleAutosave();
  }

  function markSaved() {
    $("autosaveStatus").textContent = "Saved";
    state.lastSavedAt = new Date().toISOString();
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        const payload = {
          version: 3,
          blocks: (state.blocks || []).map(b => ({
            id: b.id,
            type: b.type,
            text: b.text,
            dismissed: Array.isArray(b.dismissed) ? b.dismissed : []
          })),
          mode: window.SimpleSlateEditor.getMode?.() || "action",
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
        markSaved();
      } catch (e) {
        console.warn("Autosave failed:", e);
        $("autosaveStatus").textContent = "Autosave error";
      }
    }, AUTOSAVE_DELAY);
  }

  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.blocks)) return false;

      // Load blocks into editor
      window.SimpleSlateEditor.setBlocks(data.blocks);
      if (data.mode) window.SimpleSlateEditor.setMode(data.mode);
      window.SimpleSlateEditor.focusDraft();

      state.blocks = window.SimpleSlateEditor.getBlocks();
      updateStats();
      markSaved();
      return true;
    } catch (e) {
      console.warn("Restore autosave failed:", e);
      return false;
    }
  }

  // =============== File IO (Save/Load) ===============

  function downloadFile(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function saveScriptJSON() {
    const payload = {
      version: 3,
      blocks: window.SimpleSlateEditor.getBlocks(),
      mode: window.SimpleSlateEditor.getMode?.() || "action",
    };
    downloadFile(`${FILENAME_DEFAULT}.script`, "application/json", JSON.stringify(payload, null, 2));
    markSaved();
  }

  function attachLoadHandler() {
    const input = $("fileInput");
    input.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        let blocks = [];
        let mode = "action";

        if (Array.isArray(data)) {
          // Very old format: array of blocks directly
          blocks = data;
        } else if (data && Array.isArray(data.blocks)) {
          blocks = data.blocks;
          mode = data.mode || "action";
        } else {
          throw new Error("Invalid .script file format");
        }

        window.SimpleSlateEditor.setBlocks(blocks);
        window.SimpleSlateEditor.setMode(mode);
        window.SimpleSlateEditor.focusDraft();

        state.blocks = window.SimpleSlateEditor.getBlocks();
        updateStats();
        markSaved();
      } catch (err) {
        alert("Failed to load .script file. Make sure it's a SimpleSlate export.");
        console.error(err);
      } finally {
        input.value = "";
      }
    });
  }

  // =============== Export: PDF (print view) ===============

  function exportToPDF() {
    const w = window.open("", "_blank");
    if (!w) {
      alert("Popup blocked. Enable popups to export PDF.");
      return;
    }
    const cssHref = new URL("../css/style.css", document.currentScript.src).href;

    const esc = (s) =>
      (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const blockToHTML = (b) => {
      if (b.type === "divider") return `<hr class="block-divider">`;
      const html = esc(b.text || "").replace(/\n/g, "<br>");
      return `<p class="block block-${b.type}">${html || "<br>"}</p>`;
    };

    const body = (state.blocks || []).map(blockToHTML).join("\n");

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${FILENAME_DEFAULT}.pdf</title>
  <link rel="stylesheet" href="${cssHref}">
  <style>
    body { background:#fff !important; }
    .toolbar, .modebar { display:none !important; }
    .paper { width:8.5in; min-height:11in; border-radius:0; box-shadow:none !important; }
  </style>
</head>
<body>
  <div class="paper">
    <div class="editor" style="min-height:auto;">
      ${body}
    </div>
  </div>
  <script>setTimeout(()=>window.print(), 50);</script>
</body>
</html>`.trim();

    w.document.open(); w.document.write(html); w.document.close();
  }

  // =============== Export: FDX ===============

  function exportToFDX() {
    const xmlEsc = (s) =>
      (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const mapType = (t) => {
      switch (t) {
        case "scene": return "Scene Heading";
        case "action": return "Action";
        case "character": return "Character";
        case "parenthetical": return "Parenthetical";
        case "dialogue": return "Dialogue";
        case "transition": return "Transition";
        case "shot": return "Shot";
        case "centered": return "Action"; // safe fallback
        case "divider": return "Action";  // dashed line in action
        case "lyric": return "Lyrics";    // some FDX readers accept
        default: return "Action";
      }
    };

    const paras = (state.blocks || []).map(b => {
      const type = mapType(b.type);
      const lines = (b.text || "").split("\n");
      const txt = lines.map((ln, i) =>
        `<Text>${xmlEsc(ln)}</Text>${i < lines.length - 1 ? "<Br/>" : ""}`
      ).join("");
      return `<Paragraph Type="${xmlEsc(type)}">${txt}</Paragraph>`;
    }).join("");

    const fdx = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Version="1">
  <Content>${paras}</Content>
  <TitlePage></TitlePage>
</FinalDraft>`.trim();

    downloadFile(`${FILENAME_DEFAULT}.fdx`, "application/xml", fdx);
  }

  // =============== Buttons & Shortcuts ===============

  function bindButtons() {
    $("newBtn").addEventListener("click", () => {
      window.SimpleSlateFormatter.resetSession?.();
      window.SimpleSlateEditor.clearAll();
      window.SimpleSlateEditor.setMode("action");
      window.SimpleSlateEditor.focusDraft();
      state.blocks = [];
      updateStats();
      markDirty();
    });

    $("loadBtn").addEventListener("click", () => $("fileInput").click());
    attachLoadHandler();

    $("saveBtn").addEventListener("click", saveScriptJSON);
    $("exportPdfBtn").addEventListener("click", exportToPDF);
    $("exportFdxBtn").addEventListener("click", exportToFDX);

    $("settingsBtn").addEventListener("click", () => {
      alert("Settings coming soon: pagination grid, auto-normalize, theme, keymap.");
    });

    // Global shortcuts
    document.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === "s") { e.preventDefault(); saveScriptJSON(); }
      if (mod && k === "n") { e.preventDefault(); $("newBtn").click(); }
      if (mod && k === "p") { e.preventDefault(); exportToPDF(); }
    });
  }

  // =============== Init ===============

  function init() {
    bindButtons();
    initEditor();
    scheduleAutosave(); // kick off periodic save after init
  }

  document.addEventListener("DOMContentLoaded", init);
})();
