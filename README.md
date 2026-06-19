# Devlar — Version 2.0
### Universal Prompt Co-Pilot, Text Analyzer, and Grammar Standardizer

Devlar is a keyboard-driven Chrome Extension (Manifest V3) designed to streamline prompt engineering, text analysis, and writing refinement directly within your browser. Powered by the **Groq API** for low-latency streaming completions, Devlar provides a unified interface that allows you to process any selected text with five distinct tools instantly, regardless of the website you are on.

---

## 🌟 What's New in v2.0

* **Unified Interface:** Devlar now presents the same consistent 5-option panel for all highlighted or selected text across all websites.
* **Draggable Interface:** Grab Devlar by its header and drag the overlay window anywhere on your screen.
* **Resizable Window:** Adjust the layout to fit your display by stretching or shrinking the window horizontally and vertically.
* **Premium Visuals & Fluid Animations:** A dark glassmorphism card theme, pill-shaped tab selectors, smooth hover transitions, and a pulsing active glow.
* **Code Standardization Support:** The Standardizer detects programming languages and can correct prose, basic syntax, typos, and logical bugs in code blocks.
* **CSP-Safe Architecture:** Uses a robust native system UI font stack instead of external font imports to avoid console warnings and CSP blocking.

---

## 🛠️ The 5 Core Tools

When you select text and trigger Devlar, you can switch between five distinct processing modes:

1. **📝 Summarizer**
	*Purpose:* Distills the core meaning of the selected text into a short, direct summary.
2. **🧠 Prompt Engineer**
	*Purpose:* Rewrites rough input into a clearer, more structured prompt for LLMs.
3. **🔎 Query Refiner**
	*Purpose:* Corrects spelling, grammar, and structure while preserving search intent.
4. **📘 Explainer**
	*Purpose:* Breaks down concepts, keywords, and technical details in a clear, educational way.
5. **✍️ Standardizer**
	*Purpose:* Cleans up grammar and, for code, handles simple syntax, typo, and logic fixes.

---

## 🛠️ Key Technical Implementations

### 1. Host DOM Isolation (Shadow DOM)
To prevent the host website's stylesheets from conflicting with or breaking the extension's glassmorphism card layout, Devlar mounts its UI container inside an isolated **Shadow DOM root** (`#devlar-root`). 

### 2. Framework-Aware Writeback (Text Replacement)
For standard forms, inputs, and textareas, Devlar safely replaces the target value. To ensure compatibility with reactive virtual DOMs (such as React, Vue, or Angular), it accesses the element’s native property prototype setters to write the new value and dispatches native `input` and `change` events so application states update correctly. On complex editors, it falls back to simulated insertions via `document.execCommand`.

### 3. Lightweight Word-by-Word Diff Engine
Devlar computes and renders a visual structural diff in real-time once streaming completes. Written as a dependency-free Longest Common Subsequence (LCS) algorithm inside `content.js`, it cleanly wraps inserted text in `<ins>` tags (green background) and deleted text in `<del>` tags (red strikethrough), leaving unchanged text raw.

### 4. Private Context Profiles
Users can configure a personal background profile in the settings. When saved, this profile is privately injected into the LLM system context as metadata, allowing the inference engine to tailor explanations or prompts to the user's specific background (e.g., academic level, primary programming languages, or professional field).

---

## 📂 File Structure

```
devlar/
├── manifest.json       # Manifest V3 configuration, permissions, and background registration
├── background.js       # Background service worker, context menu builder, system prompts, Groq API stream
├── content.js          # DOM scanning, Shadow DOM injection, diff engine, selection coords, writeback
├── options.html        # Glassmorphism options and setup page
├── options.js          # Storage logic, API key connection validation, profile management
└── options.css         # Styling for options page
```

---

## 🚀 Installation & Setup

### Prerequisites
* Google Chrome or any Chromium-compatible browser.
* A valid API key from the [Groq Console](https://console.groq.com/keys) (free tier is sufficient).

### Steps
1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner and select the directory containing the extension files.
5. Click the extension icon in your toolbar to open the options page in a full tab.
6. Paste your Groq API Key and click **Save Key** (you can optionally test the connection using the **Test Key** button).
7. (Optional) Describe your academic or professional background in the **Context Profile** section to enable personalized output generations.

---

## ⌨️ Keyboard Shortcuts

* **Default Shortcut:** `Alt+Shift+D`
* **Customization:** You can remap this command at any time by visiting `chrome://extensions/shortcuts` in your browser.