# Devlar

Devlar is a context-aware Chrome Extension (Manifest V3) designed to streamline prompt engineering, text analysis, and writing refinement directly within the browser. Powered by the **Groq API** for low-latency streaming completions, Devlar dynamically adapts its interface and system instructions depending on where and how you interact with a web page.

---

## 🎯 Core Scenarios

Devlar automatically detects the active DOM environment and transitions between four distinct operational modes:

| Scenario | Target Environment | Active Role | Behaviors & Features |
| :--- | :--- | :--- | :--- |
| **Scenario A** | AI Inputs (ChatGPT, Claude, Gemini, Perplexity, etc.) | **Prompt Engineer** | Transforms rough text drafts into optimized, platform-specific prompts. Provides **Concise**, **Expert**, and **Structured** style tabs within the UI. |
| **Scenario B** | Static Text (Wikipedia, documentation, blogs, etc.) | **Text Analyst** | Analyzes the highlighted selection. Provides **Concise**, **In-Depth**, and **Standard Grammar** analysis tabs. |
| **Scenario C** | Search Engines (Google, Bing, Yandex, etc.) | **Query Refiner** | Corrects grammar, spelling, and structural syntax strictly for short queries without changing intent. Hides selector tabs to minimize UI friction. |
| **Scenario D** | Chat Inputs (WhatsApp, Discord, Slack, etc.) | **Chat Assistant** | Refines draft messages, correcting spelling and grammar while preserving the user’s original tone, formatting, and emojis. Hides tab selectors and the replace action to ensure safety on complex chat platforms. |

---

## 🛠️ Key Technical Implementations

### 1. Host DOM Isolation (Shadow DOM)
To prevent the host website's stylesheets from conflicting with or breaking the extension's glassmorphism card layout, Devlar mounts its UI container inside an isolated **Shadow DOM root** (`#devlar-root`). 

### 2. Context-Aware Pipeline
The content script listens to native browser events (`focusin`, `mousedown`, `contextmenu`, `keyup`, and `selectionchange`) to identify whether the target element is a plain input, a native `<textarea>`, a custom `contenteditable` component, or static text. It dynamically re-registers Chrome's context menu contexts between `["selection"]` and `["selection", "editable"]` on the fly.

### 3. Framework-Aware Writeback (Text Replacement)
For standard forms, inputs, and textareas, Devlar safely replaces the target value. To ensure compatibility with reactive virtual DOMs (such as React, Vue, or Angular), it accesses the element’s native property prototype setters to write the new value and dispatches native `input` and `change` events so application states update correctly. On complex editors, it falls back to simulated insertions via `document.execCommand`.

### 4. Lightweight Word-by-Word Diff Engine
For Scenarios C and D, Devlar computes and renders a visual structural diff in real-time once streaming completes. Written as a dependency-free Longest Common Subsequence (LCS) algorithm inside `content.js`, it cleanly wraps inserted text in `<ins>` tags (green background) and deleted text in `<del>` tags (red strikethrough), leaving unchanged text raw.

### 5. Private Context Profiles
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