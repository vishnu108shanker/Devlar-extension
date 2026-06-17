// ─── State ──────────────────────────────────────────────────────────────────
let overlayContainer = null;
let shadowRoot = null;
let streamContentEl = null;
let lastTargetElement = null; // Track target elements for writeback replacements

// ─── AI Domain List (must match background.js) ─────────────────────────────
const AI_DOMAINS = [
  "chat.openai.com", "chatgpt.com",
  "claude.ai",
  "gemini.google.com",
  "perplexity.ai",
  "grok.com",
  "copilot.microsoft.com",
  "groq.com", "chat.groq.com",
  "nastia.ai"
];

const SEARCH_DOMAINS = [
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com", "ecosia.org", "yandex.com"
];

function isAIDomain() {
  const host = window.location.hostname;
  return AI_DOMAINS.some(d => host === d || host.endsWith("." + d));
}

// ─── Input Detection ────────────────────────────────────────────────────────
function isSearchDomain() {
  const host = window.location.hostname;
  return SEARCH_DOMAINS.some(d => host === d || host.endsWith("." + d));
}

function isInputElement(el) {
  if (!el) return false;
  
  // Evaluate text nodes via parent
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
    
    if (node.classList && typeof node.classList.contains === "function") {
      if (
        node.classList.contains("lexical") || 
        node.classList.contains("selectable-text") ||
        node.classList.contains("ProseMirror") || 
        node.classList.contains("draft-js-editor") || 
        node.classList.contains("ql-editor")
      ) {
        return true;
      }
    }
    return false;
  };

  if (checkNode(curr)) return true;
  if (checkNode(document.activeElement)) return true;
  
  // Traverse DOM ancestry
  let parent = curr ? curr.parentElement : null;
  for (let i = 0; i < 15 && parent; i++) {
    if (checkNode(parent)) return true;
    parent = parent.parentElement;
  }

  // Handle active element in shadow tree
  let activeEl = document.activeElement;
  while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement;
    if (checkNode(activeEl)) return true;
  }

  return false;
}

function isTargetEditable() {
  return lastTargetElement && isInputElement(lastTargetElement);
}

// ─── Scenario Detection ─────────────────────────────────────────────────────
let lastScenario = null;

function detectScenario(targetEl) {
  const inInput = isInputElement(targetEl);
  const onAI = isAIDomain();
  const onSearch = isSearchDomain();

  if (inInput && onAI) return "A";       // AI site input
  if (inInput && onSearch) return "C";   // Standard search engine input
  if (inInput) return "D";               // Default input behavior (Chat Assistant)
  return "B";                             // Static text
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
    // Suppress context invalidation errors
  }
}

function notifyScenario(scenario) {
  if (scenario !== lastScenario) {
    lastScenario = scenario;
    safeSendMessage({ action: "updateContextMenu", scenario });
  }
}

// ─── Event Listeners ────────────────────────────────────────────────────────
document.addEventListener("focusin", (e) => {
  notifyScenario(detectScenario(e.target));
}, true);

document.addEventListener("mousedown", (e) => {
  notifyScenario(detectScenario(e.target));
}, true);

document.addEventListener("contextmenu", (e) => {
  notifyScenario(detectScenario(e.target));
}, true);

document.addEventListener("keyup", (e) => {
  notifyScenario(detectScenario(e.target));
}, true);

document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const anchor = sel.anchorNode;
    const el = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
    notifyScenario(detectScenario(el));
  }
});

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

      // Access prototype descriptors to update values in React/Vue virtual DOMs
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

      // Dispatch events to trigger virtual DOM updates
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      targetEl.value = optimizedText;
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    // Handle contenteditable, DraftJS, Lexical, ProseMirror, Slate, etc.
    const sel = window.getSelection();
    if (sel) {
      // If there is no highlight selection, select all content so insertText replaces it fully
      if (!sel.toString().trim() || !targetEl.contains(sel.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(targetEl);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      try {
        // execCommand triggers native editor engines to adjust virtual DOM state smoothly
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

// ─── Overlay Styles (Shadow DOM) ────────────────────────────────────────────
const overlayStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  :host { all: initial; }

  .overlay-card {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    position: absolute;
    width: 440px;
    background: rgba(14, 16, 24, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 16px;
    color: #f3f4f6;
    padding: 18px 20px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1);
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    box-sizing: border-box;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .overlay-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .title {
    font-size: 0.875rem;
    font-weight: 700;
    background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .site-badge {
    font-size: 0.65rem;
    padding: 2px 7px;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.25);
    border-radius: 20px;
    color: #a5b4fc;
    -webkit-text-fill-color: #a5b4fc;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .dismiss-btn:hover { background: rgba(255,255,255,0.07); color: #f3f4f6; }

  /* Style Selector */
  .style-selector {
    display: flex;
    background: rgba(0,0,0,0.25);
    border-radius: 8px;
    padding: 3px;
    margin-bottom: 12px;
    gap: 2px;
  }

  .style-tab {
    flex: 1;
    background: none;
    border: none;
    color: #6b7280;
    font-size: 0.72rem;
    font-weight: 500;
    padding: 6px 2px;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
    font-family: inherit;
    white-space: nowrap;
  }
  .style-tab:hover { color: #d1d5db; background: rgba(255,255,255,0.04); }
  .style-tab.active {
    color: #fff;
    background: #5c5fea;
    box-shadow: 0 2px 8px rgba(92,95,234,0.35);
  }

  /* Content area */
  .content-area {
    font-size: 0.83rem;
    line-height: 1.6;
    overflow-y: auto;
    max-height: 210px;
    margin-bottom: 14px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #e5e7eb;
    padding-right: 4px;
    min-height: 40px;
  }
  .content-area::-webkit-scrollbar { width: 5px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
  .content-area::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

  /* Typing cursor */
  .typing-cursor {
    display: inline-block;
    width: 2px;
    height: 0.95em;
    background: #6366f1;
    border-radius: 1px;
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: blink 0.7s infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  /* Loading */
  .loader-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 0;
    color: #6b7280;
    font-size: 0.8rem;
    gap: 10px;
  }
  .spinner {
    width: 26px;
    height: 26px;
    border: 2px solid rgba(99,102,241,0.12);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error */
  .error-container {
    color: #fb7185;
    padding: 12px;
    background: rgba(244,63,94,0.07);
    border: 1px solid rgba(244,63,94,0.18);
    border-radius: 8px;
    font-size: 0.8rem;
    margin-bottom: 14px;
    line-height: 1.5;
  }

  /* Footer Layout */
  .overlay-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(255,255,255,0.05);
    padding-top: 12px;
    gap: 12px;
  }

  .footer-hint {
    font-size: 0.72rem;
    color: #a5b4fc;
    opacity: 0.85;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  .footer-buttons {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .btn {
    padding: 8px 16px;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.18s;
    font-family: inherit;
  }
  .btn-copy {
    background: #5c5fea;
    color: #fff;
    border: none;
    box-shadow: 0 3px 10px rgba(92,95,234,0.25);
  }
  .btn-copy:hover { background: #4f52d4; transform: translateY(-1px); }
  
  .btn-replace {
    background: #4f46e5;
    color: #fff;
    border: none;
    box-shadow: 0 3px 10px rgba(79,70,229,0.25);
  }
  .btn-replace:hover { background: #4338ca; transform: translateY(-1px); }

  .btn-dismiss {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: #9ca3af;
  }
  .btn-dismiss:hover { background: rgba(255,255,255,0.05); color: #d1d5db; }
  .btn:active { transform: translateY(0) !important; }
`;

// ─── Mode Config: titles, badges, and tab sets ──────────────────────────────
const MODE_CONFIG = {
  // Scenario A — AI Prompt
  ai_concise:    { scenario: "A", title: "Devlar", badge: null, tabs: "ai" },
  ai_expert:     { scenario: "A", title: "Devlar", badge: null, tabs: "ai" },
  ai_structured: { scenario: "A", title: "Devlar", badge: null, tabs: "ai" },
  // Scenario B — Static Text
  static_concise: { scenario: "B", title: "Devlar", badge: "📖 Text Analysis", tabs: "static" },
  static_explain: { scenario: "B", title: "Devlar", badge: "📖 Text Analysis", tabs: "static" },
  static_grammar: { scenario: "B", title: "Devlar", badge: "✍️ Grammar",       tabs: "static" },
  // Scenario C — Search/Standard
  standard_grammar: { scenario: "C", title: "Devlar", badge: "✍️ Grammar Check", tabs: "standard" },
  // Scenario D — Chat Apps & All Other Inputs
  chat_standard: { scenario: "D", title: "Devlar", badge: "💬 Chat Assistant", tabs: "standard" },
};

function getHeaderHTML(mode, siteContext) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.static_concise;
  let badgeHTML = "";

  if (config.scenario === "A" && siteContext) {
    badgeHTML = ` <span style="color:#6b7280; font-weight:400; margin:0 4px;">~</span> <span class="site-badge">🎯 ${siteContext.name}</span>`;
  } else if (config.badge) {
    badgeHTML = ` <span style="color:#6b7280; font-weight:400; margin:0 4px;">~</span> <span class="site-badge">${config.badge}</span>`;
  }

  return `<span class="title">✨ ${config.title}${badgeHTML}</span>`;
}

function renderModeTabs(currentMode) {
  const config = MODE_CONFIG[currentMode] || MODE_CONFIG.static_concise;

  if (config.tabs === "ai") {
    return `<div class="style-selector">
      <button class="style-tab ${currentMode === "ai_concise"    ? "active" : ""}" data-mode="ai_concise">⚡ Concise</button>
      <button class="style-tab ${currentMode === "ai_expert"     ? "active" : ""}" data-mode="ai_expert">🎓 Expert</button>
      <button class="style-tab ${currentMode === "ai_structured" ? "active" : ""}" data-mode="ai_structured">📊 Structured</button>
    </div>`;
  } else if (config.tabs === "static") {
    return `<div class="style-selector">
      <button class="style-tab ${currentMode === "static_concise" ? "active" : ""}" data-mode="static_concise">⚡ Concise</button>
      <button class="style-tab ${currentMode === "static_explain" ? "active" : ""}" data-mode="static_explain">📖 Explanation</button>
      <button class="style-tab ${currentMode === "static_grammar" ? "active" : ""}" data-mode="static_grammar">✍️ Standard Format</button>
    </div>`;
  } else {
    return "";
  }
}

// ─── Overlay Helpers ────────────────────────────────────────────────────────
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
    // Track active target element for replacements
    lastTargetElement = activeEl;

    const details = getSelectionDetails();
    sendResponse({ text: details.text, coords: getSelectionCoords() });
  }
  else if (request.action === "showOverlayLoading") {
    ensureOverlayCreated();
    renderLoading(request.rawText, request.currentMode, request.coords, request.siteContext);
  }
  else if (request.action === "showOverlayStreamStart") {
    ensureOverlayCreated();
    renderStreamStart(request.rawText, request.currentMode, request.coords, request.siteContext, request.persona);
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
    finalizeStream(request.fullText, request.rawText, request.currentMode, request.coords, request.siteContext, request.persona);
  }
  else if (request.action === "showOverlayError") {
    ensureOverlayCreated();
    renderError(request.message, request.coords);
  }
  return true;
});

// ─── Render: Loading Spinner ─────────────────────────────────────────────────
function renderLoading(rawText, currentMode, coords, siteContext) {
  clearShadow();
  const card = document.createElement("div");
  card.className = "overlay-card";
  card.innerHTML = `
    <div class="overlay-header">
      ${getHeaderHTML(currentMode, siteContext)}
      <button class="dismiss-btn" id="optCloseBtn">×</button>
    </div>
    ${renderModeTabs(currentMode)}
    <div class="loader-container">
      <div class="spinner"></div>
      <span>Processing...</span>
    </div>
  `;
  shadowRoot.appendChild(card);
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Render: Streaming Start ─────────────────────────────────────────────────
function renderStreamStart(rawText, currentMode, coords, siteContext, persona) {
  clearShadow();
  const card = document.createElement("div");
  card.className = "overlay-card";
  card.innerHTML = `
    <div class="overlay-header">
      ${getHeaderHTML(currentMode, siteContext)}
      <button class="dismiss-btn" id="optCloseBtn">×</button>
    </div>
    ${renderModeTabs(currentMode)}
    <div class="content-area" id="optStreamContent"><span class="typing-cursor"></span></div>
  `;
  shadowRoot.appendChild(card);
  streamContentEl = card.querySelector("#optStreamContent");
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  attachTabEvents(rawText, coords, siteContext, persona);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Finalize: Add Footer Buttons ────────────────────────────────────────────
function finalizeStream(fullText, rawText, currentMode, coords, siteContext, persona) {
  if (streamContentEl) {
    const isGrammarMode = currentMode === "standard_grammar" || currentMode === "chat_standard";
    if (isGrammarMode && rawText) {
      // Render word-by-word structural diff
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

  // Display helpful clarification block in Scenario D
  let hintHTML = "";
  if (currentMode === "chat_standard") {
    hintHTML = `<span class="footer-hint">💬 Standard chat should look like this</span>`;
  }

  // Display writeback button only if active element is editable and not in Chat Assistant mode
  const showReplace = isTargetEditable() && currentMode !== "chat_standard";
  const replaceBtnHTML = showReplace ? `<button class="btn btn-replace" id="optReplaceBtn">Replace</button>` : "";

  footer.innerHTML = `
    ${hintHTML}
    <div class="footer-buttons">
      <button class="btn btn-dismiss" id="optDismissBtn">Dismiss</button>
      ${replaceBtnHTML}
      <button class="btn btn-copy" id="optCopyBtn">Copy</button>
    </div>
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

  attachTabEvents(rawText, coords, siteContext, persona);
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
  card.querySelector("#optCloseBtn").addEventListener("click", dismissOverlay);
  card.querySelector("#optDismissBtn").addEventListener("click", dismissOverlay);
  setTimeout(() => positionOverlay(coords), 10);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clearShadow() {
  const styleTag = shadowRoot.querySelector("style");
  shadowRoot.innerHTML = "";
  shadowRoot.appendChild(styleTag);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, t =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[t]));
}

function attachTabEvents(rawText, coords, siteContext, persona) {
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
        siteContext,
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