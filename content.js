// ─── State ──────────────────────────────────────────────────────────────────
let overlayContainer = null;
let shadowRoot = null;
let streamContentEl = null;
let lastTargetElement = null; // Track targets for selections/replacements

// Drag State
let isDraggingOverlay = false;
let dragStartX = 0, dragStartY = 0;
let dragInitialLeft = 0, dragInitialTop = 0;

window.addEventListener("mousemove", (e) => {
  if (!isDraggingOverlay || !overlayContainer) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  overlayContainer.style.left = `${dragInitialLeft + dx}px`;
  overlayContainer.style.top = `${dragInitialTop + dy}px`;
});

window.addEventListener("mouseup", () => {
  if (isDraggingOverlay) {
    isDraggingOverlay = false;
    document.body.style.userSelect = "";
  }
});

function isInputElement(el) {
  if (!el) return false;
  let curr = el.nodeType === 3 ? el.parentElement : el;

  const checkNode = (node) => {
    if (!node) return false;
    const tagName = node.tagName ? node.tagName.toUpperCase() : "";
    if (tagName === "TEXTAREA" || tagName === "INPUT") return true;
    if (node.isContentEditable) return true;
    
    if (typeof node.getAttribute === "function") {
      if (node.getAttribute("contenteditable") === "true") return true;
      if (node.getAttribute("role") === "textbox") return true;
    }
    return false;
  };

  if (checkNode(curr)) return true;
  if (checkNode(document.activeElement)) return true;
  
  let parent = curr ? curr.parentElement : null;
  for (let i = 0; i < 15 && parent; i++) {
    if (checkNode(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function isTargetEditable() {
  return lastTargetElement && isInputElement(lastTargetElement);
}

function safeSendMessage(message, callback) {
  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError; 
        if (callback) callback(response);
      });
    }
  } catch (e) {
    // Context invalidated suppression
  }
}

// ─── Word-by-Word Diff Algorithm (LCS) ──────────────────────────────────────
function computeWordDiff(oldStr, newStr) {
  const oldWords = oldStr.split(/(\s+)/);
  const newWords = newStr.split(/(\s+)/);
  
  const dp = Array(oldWords.length + 1).fill(null).map(() => Array(newWords.length + 1).fill(0));
  
  for (let i = 1; i <= oldWords.length; i++) {
    for (let j = 1; j <= newWords.length; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  let i = oldWords.length;
  let j = newWords.length;
  const diff = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      diff.unshift({ type: "equal", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: "insert", text: newWords[j - 1] });
      j--;
    } else {
      diff.unshift({ type: "delete", text: oldWords[i - 1] });
      i--;
    }
  }
  
  return diff.map(part => {
    if (part.type === "insert") {
      if (!part.text.trim()) return part.text;
      return `<ins style="color: #10b981; text-decoration: none; background: rgba(16,185,129,0.15); padding: 0 2px; border-radius: 3px;">${escapeHTML(part.text)}</ins>`;
    } else if (part.type === "delete") {
      if (!part.text.trim()) return "";
      return `<del style="color: #f43f5e; text-decoration: line-through; background: rgba(244,63,94,0.15); padding: 0 2px; border-radius: 3px;">${escapeHTML(part.text)}</del>`;
    } else {
      return escapeHTML(part.text);
    }
  }).join("");
}

// ─── Direct Selection Replacement (Writeback) Helper ────────────────────────
function writeBackText(targetEl, optimizedText) {
  if (!targetEl) return;
  targetEl.focus();

  const isInputOrTextarea = targetEl.tagName === "INPUT" || targetEl.tagName === "TEXTAREA";

  if (isInputOrTextarea) {
    try {
      const start = targetEl.selectionStart;
      const end = targetEl.selectionEnd;

      const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set 
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

      if (typeof start === "number" && typeof end === "number" && start !== end) {
        const val = targetEl.value;
        const updatedVal = val.substring(0, start) + optimizedText + val.substring(end);
        if (nativeValueSetter) {
          nativeValueSetter.call(targetEl, updatedVal);
        } else {
          targetEl.value = updatedVal;
        }
        targetEl.selectionStart = targetEl.selectionEnd = start + optimizedText.length;
      } else {
        if (nativeValueSetter) {
          nativeValueSetter.call(targetEl, optimizedText);
        } else {
          targetEl.value = optimizedText;
        }
      }

      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      targetEl.value = optimizedText;
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } else {
    const sel = window.getSelection();
    if (sel) {
      if (!sel.toString().trim() || !targetEl.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(targetEl);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      try {
        const success = document.execCommand("insertText", false, optimizedText);
        if (!success) {
          targetEl.innerText = optimizedText;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (e) {
        targetEl.innerText = optimizedText;
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
}

// ─── Overlay Styles (Shadow DOM with Local Fallbacks - CSP Safe) ─────────────
const overlayStyles = `
  :host { all: initial; }

  .overlay-card {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    position: absolute;
    width: 440px;
    background: linear-gradient(145deg, rgba(18, 20, 31, 0.95) 0%, rgba(10, 12, 18, 0.98) 100%);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    color: #f3f4f6;
    padding: 20px 24px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-sizing: border-box;
    resize: both;
    overflow: hidden;
    min-width: 320px;
    min-height: 200px;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateY(12px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .overlay-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    cursor: grab;
    user-select: none;
  }
  .overlay-header:active {
    cursor: grabbing;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 800;
    background: linear-gradient(135deg, #c7d2fe 0%, #818cf8 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    letter-spacing: 0.5px;
  }

  .dismiss-btn {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.05);
    color: #9ca3af;
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  .dismiss-btn:hover { background: rgba(244,63,94,0.15); color: #fb7185; border-color: rgba(244,63,94,0.3); transform: scale(1.05); }

  /* Tab Styles (Animated Buttons) */
  .style-selector {
    display: flex;
    flex-wrap: wrap;
    background: rgba(0,0,0,0.3);
    border-radius: 12px;
    padding: 6px;
    margin-bottom: 16px;
    gap: 6px;
    border: 1px solid rgba(255,255,255,0.04);
  }

  .style-tab {
    flex: 1;
    background: rgba(255,255,255,0.02);
    border: 1px solid transparent;
    color: #9ca3af;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 8px 6px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    text-align: center;
    font-family: inherit;
    white-space: nowrap;
    position: relative;
    overflow: hidden;
  }
  .style-tab:hover { 
    color: #e5e7eb; 
    background: rgba(255,255,255,0.08); 
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  .style-tab:active {
    transform: translateY(0);
  }
  .style-tab.active {
    color: #ffffff;
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
    border-color: rgba(255,255,255,0.1);
    box-shadow: 0 4px 15px rgba(99,102,241,0.4);
    transform: translateY(-1px);
    animation: pulseGlow 2s infinite alternate;
  }

  @keyframes pulseGlow {
    0% { box-shadow: 0 4px 15px rgba(99,102,241,0.4); }
    100% { box-shadow: 0 4px 20px rgba(99,102,241,0.6); }
  }

  /* Content Area */
  .content-area {
    font-size: 0.88rem;
    line-height: 1.65;
    overflow-y: auto;
    max-height: 240px;
    flex-grow: 1;
    margin-bottom: 16px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #e5e7eb;
    padding-right: 8px;
    min-height: 60px;
  }
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 3px; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
  .content-area::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

  /* Typing Cursor */
  .typing-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: #818cf8;
    border-radius: 2px;
    margin-left: 3px;
    vertical-align: text-bottom;
    animation: blink 0.7s infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  /* Loader */
  .loader-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 36px 0;
    color: #9ca3af;
    font-size: 0.85rem;
    gap: 12px;
    font-weight: 500;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(99,102,241,0.15);
    border-top-color: #818cf8;
    border-radius: 50%;
    animation: spin 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error */
  .error-container {
    color: #ffe4e6;
    padding: 14px;
    background: linear-gradient(135deg, rgba(225,29,72,0.15) 0%, rgba(190,18,60,0.2) 100%);
    border: 1px solid rgba(244,63,94,0.3);
    border-radius: 10px;
    font-size: 0.85rem;
    margin-bottom: 16px;
    line-height: 1.6;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  }

  /* Footer Layout */
  .overlay-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    border-top: 1px solid rgba(255,255,255,0.06);
    padding-top: 14px;
    gap: 10px;
    margin-top: auto;
  }

  .btn {
    padding: 10px 18px;
    font-size: 0.8rem;
    font-weight: 700;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: inherit;
    letter-spacing: 0.3px;
  }
  .btn-copy {
    background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 4px 12px rgba(79,70,229,0.3);
  }
  .btn-copy:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(79,70,229,0.4); }
  
  .btn-replace {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 4px 12px rgba(16,185,129,0.3);
  }
  .btn-replace:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(16,185,129,0.4); }

  .btn-dismiss {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    color: #d1d5db;
  }
  .btn-dismiss:hover { background: rgba(255,255,255,0.08); color: #fff; transform: translateY(-2px); }
  .btn:active { transform: translateY(1px) !important; box-shadow: none !important; }
`;

// ─── Mode Config: Titles & Tabs ──────────────────────────────────────────────
const MODES = [
  { id: "summarize", label: "📝 Summarize" },
  { id: "prompt_engineer", label: "🤖 Prompt" },
  { id: "query_refiner", label: "🔍 Refine Query" },
  { id: "explain", label: "🎓 Explain" },
  { id: "standardize", label: "✍️ Standardize" }
];

function getHeaderHTML() {
  return `<span class="title">✨ Devlar</span>`;
}

function renderModeTabs(currentMode) {
  let tabsHTML = `<div class="style-selector">`;
  MODES.forEach(mode => {
    const activeClass = currentMode === mode.id ? "active" : "";
    tabsHTML += `<button class="style-tab ${activeClass}" data-mode="${mode.id}">${mode.label}</button>`;
  });
  tabsHTML += `</div>`;
  return tabsHTML;
}

// ─── Overlay Handlers ────────────────────────────────────────────────────────
function ensureOverlayCreated() {
  if (overlayContainer) return;
  overlayContainer = document.createElement("div");
  overlayContainer.id = "devlar-root";
  overlayContainer.style.cssText = "position:absolute;z-index:999999999;pointer-events:none;";
  document.body.appendChild(overlayContainer);
  shadowRoot = overlayContainer.attachShadow({ mode: "open" });
  const styleEl = document.createElement("style");
  styleEl.textContent = overlayStyles;
  shadowRoot.appendChild(styleEl);
}

function dismissOverlay() {
  if (overlayContainer) { overlayContainer.remove(); overlayContainer = null; shadowRoot = null; streamContentEl = null; }
}

function positionOverlay(coords) {
  if (!coords || !overlayContainer) return;
  const card = shadowRoot.querySelector(".overlay-card");
  if (!card) return;
  const cardWidth = 440;
  const cardHeight = card.offsetHeight || 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = coords.left + (coords.width / 2) - (cardWidth / 2);
  let top  = coords.bottom + 12;

  if (left < 10) left = 10;
  if (left + cardWidth > vw - 10) left = vw - cardWidth - 10;
  if (top + cardHeight > window.scrollY + vh - 10) top = coords.top - cardHeight - 12;
  if (top < window.scrollY + 10) top = window.scrollY + 10;

  overlayContainer.style.left = `${left}px`;
  overlayContainer.style.top  = `${top}px`;
}

function getSelectionDetails() {
  let text = "";
  let activeEl = document.activeElement;

  while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement;
  }

  const isInputOrTextarea = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

  if (isInputOrTextarea) {
    try {
      const start = activeEl.selectionStart;
      const end = activeEl.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && start !== end) {
        text = activeEl.value.substring(start, end).trim();
      } else {
        text = activeEl.value.trim();
      }
    } catch (e) {
      text = activeEl.value.trim();
    }
  } else {
    text = window.getSelection().toString().trim();
    if (!text && isInputElement(activeEl)) {
      text = activeEl.innerText || activeEl.textContent || "";
      text = text.trim();
    }
  }

  return { text };
}

function getSelectionCoords() {
  let activeEl = document.activeElement;
  while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement;
  }

  const isInputOrTextarea = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

  if (isInputOrTextarea || (activeEl && isInputElement(activeEl))) {
    const rect = activeEl.getBoundingClientRect();
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height
      };
    }
  }

  if (activeEl) {
    const rect = activeEl.getBoundingClientRect();
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  return {
    left: window.innerWidth / 2 + window.scrollX - 50,
    top: window.innerHeight / 2 + window.scrollY - 50,
    right: window.innerWidth / 2 + window.scrollX + 50,
    bottom: window.innerHeight / 2 + window.scrollY + 50,
    width: 100,
    height: 100
  };
}

// ─── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSelectedText") {
    let activeEl = document.activeElement;
    while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
      activeEl = activeEl.shadowRoot.activeElement;
    }
    lastTargetElement = activeEl;

    const details = getSelectionDetails();
    sendResponse({ text: details.text, coords: getSelectionCoords() });
  }
  else if (request.action === "showOverlayLoading") {
    ensureOverlayCreated();
    renderLoading(request.rawText, request.currentMode, request.coords);
  }
  else if (request.action === "showOverlayStreamStart") {
    ensureOverlayCreated();
    renderStreamStart(request.rawText, request.currentMode, request.coords, request.persona);
  }
  else if (request.action === "appendStreamChunk") {
    if (streamContentEl) {
      streamContentEl.textContent = request.fullText;
      const cursor = document.createElement("span");
      cursor.className = "typing-cursor";
      streamContentEl.appendChild(cursor);
      streamContentEl.scrollTop = streamContentEl.scrollHeight;
    }
  }
  else if (request.action === "showOverlayStreamComplete") {
    finalizeStream(request.fullText, request.rawText, request.currentMode, request.coords, request.persona);
  }
  else if (request.action === "showOverlayError") {
    ensureOverlayCreated();
    renderError(request.message, request.coords);
  }
  return true;
});

// ─── Render: Loading Spinner ─────────────────────────────────────────────────
function renderLoading(rawText, currentMode, coords) {
  clearShadow();
  const card = document.createElement("div");
  card.className = "overlay-card";
  card.innerHTML = `
    <div class="overlay-header">
      ${getHeaderHTML()}
      <button class="dismiss-btn" id="optCloseBtn">×</button>
    </div>
    ${renderModeTabs(currentMode)}
    <div class="loader-container">
      <div class="spinner"></div>
      <span>Processing...</span>
    </div>
  `;
  shadowRoot.appendChild(card);
  attachDragToHeader();
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Render: Streaming Start ─────────────────────────────────────────────────
function renderStreamStart(rawText, currentMode, coords, persona) {
  clearShadow();
  const card = document.createElement("div");
  card.className = "overlay-card";
  card.innerHTML = `
    <div class="overlay-header">
      ${getHeaderHTML()}
      <button class="dismiss-btn" id="optCloseBtn">×</button>
    </div>
    ${renderModeTabs(currentMode)}
    <div class="content-area" id="optStreamContent"><span class="typing-cursor"></span></div>
  `;
  shadowRoot.appendChild(card);
  attachDragToHeader();
  streamContentEl = card.querySelector("#optStreamContent");
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  attachTabEvents(rawText, coords, persona);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Finalize: Footer Actions ────────────────────────────────────────────────
function finalizeStream(fullText, rawText, currentMode, coords, persona) {
  if (streamContentEl) {
    const isDiffMode = currentMode === "standardize" || currentMode === "query_refiner";
    if (isDiffMode && rawText) {
      streamContentEl.innerHTML = computeWordDiff(rawText, fullText);
    } else {
      streamContentEl.textContent = fullText;
    }
  }
  streamContentEl = null;

  const card = shadowRoot.querySelector(".overlay-card");
  if (!card) return;

  const old = card.querySelector(".overlay-footer");
  if (old) old.remove();

  const footer = document.createElement("div");
  footer.className = "overlay-footer";

  // Replace option matches with editable context
  const showReplace = isTargetEditable();
  const replaceBtnHTML = showReplace ? `<button class="btn btn-replace" id="optReplaceBtn">Replace</button>` : "";

  footer.innerHTML = `
    <button class="btn btn-dismiss" id="optDismissBtn">Dismiss</button>
    ${replaceBtnHTML}
    <button class="btn btn-copy" id="optCopyBtn">Copy</button>
  `;
  card.appendChild(footer);
  footer.querySelector("#optDismissBtn").addEventListener("click", dismissOverlay);
  const copyBtn = footer.querySelector("#optCopyBtn");
  copyBtn.addEventListener("click", () => copyToClipboard(fullText, copyBtn));

  if (showReplace) {
    const replaceBtn = footer.querySelector("#optReplaceBtn");
    replaceBtn.addEventListener("click", () => {
      writeBackText(lastTargetElement, fullText);
      
      const originalText = replaceBtn.innerHTML;
      replaceBtn.innerHTML = "Replaced! ✓";
      replaceBtn.style.background = "#059669";
      replaceBtn.style.boxShadow = "0 3px 10px rgba(5,150,105,0.35)";
      
      setTimeout(() => {
        replaceBtn.innerHTML = originalText;
        replaceBtn.style.background = "";
        replaceBtn.style.boxShadow = "";
        dismissOverlay();
      }, 1000);
    });
  }

  attachTabEvents(rawText, coords, persona);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Render: Error ───────────────────────────────────────────────────────────
function renderError(message, coords) {
  clearShadow();
  const card = document.createElement("div");
  card.className = "overlay-card";
  card.innerHTML = `
    <div class="overlay-header">
      <span class="title">⚠️ Devlar Error</span>
      <button class="dismiss-btn" id="optCloseBtn">×</button>
    </div>
    <div class="error-container">${escapeHTML(message)}</div>
    <div class="overlay-footer">
      <button class="btn btn-dismiss" id="optDismissBtn">Dismiss</button>
    </div>
  `;
  shadowRoot.appendChild(card);
  attachDragToHeader();
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  card.querySelector("#optDismissBtn").addEventListener("click", dismissOverlay);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function attachDragToHeader() {
  if (!shadowRoot) return;
  const header = shadowRoot.querySelector(".overlay-header");
  if (!header) return;
  
  header.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.dismiss-btn')) return;

    isDraggingOverlay = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragInitialLeft = parseInt(overlayContainer.style.left || 0, 10);
    dragInitialTop = parseInt(overlayContainer.style.top || 0, 10);
    document.body.style.userSelect = "none";
  });
}

function clearShadow() {
  const styleTag = shadowRoot.querySelector("style");
  shadowRoot.innerHTML = "";
  shadowRoot.appendChild(styleTag);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, t =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[t]));
}

function attachTabEvents(rawText, coords, persona) {
  const tabs = shadowRoot.querySelectorAll(".style-tab");
  tabs.forEach(tab => {
    const clone = tab.cloneNode(true);
    tab.parentNode.replaceChild(clone, tab);
    clone.addEventListener("click", (e) => {
      const selectedMode = e.currentTarget.getAttribute("data-mode");
      safeSendMessage({
        action: "requestStyleChange",
        text: rawText,
        mode: selectedMode,
        coords,
        persona
      });
    });
  });
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.innerHTML;
    btn.innerHTML = "Copied! ✓";
    btn.style.background = "#059669";
    btn.style.boxShadow = "0 3px 10px rgba(5,150,105,0.35)";
    setTimeout(() => { btn.innerHTML = original; btn.style.background = ""; btn.style.boxShadow = ""; }, 1800);
  } catch (e) {
    console.error("Copy failed:", e);
  }
}