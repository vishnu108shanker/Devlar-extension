console.log("Devlar background service worker loaded.");

// ─── AI Site Domains ────────────────────────────────────────────────────────
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

const SITE_HINTS = {
  "chat.openai.com": { name: "ChatGPT", hint: "ChatGPT responds best to clear, direct instructions. Be explicit about desired output format, tone, and length." },
  "chatgpt.com":     { name: "ChatGPT", hint: "ChatGPT responds best to clear, direct instructions. Be explicit about desired output format, tone, and length." },
  "claude.ai":       { name: "Claude",  hint: "Claude excels at nuanced reasoning and follows detailed, structured instructions precisely. Use numbered steps and include edge cases." },
  "gemini.google.com":{ name: "Gemini", hint: "Gemini handles multimodal tasks, coding, and analysis well. Be clear about scope and format." },
  "perplexity.ai":   { name: "Perplexity", hint: "Perplexity is search-augmented. Make prompts keyword-rich and specify source types, recency, and citation requirements." },
  "grok.com":        { name: "Grok",    hint: "Grok handles wit, real-time info, and technical tasks well. It can access X/Twitter data." },
  "copilot.microsoft.com": { name: "Copilot", hint: "Copilot integrates with web search and Microsoft 365. Specify whether you want search-grounded or model-generated responses." },
  "groq.com":        { name: "Groq",    hint: "Groq provides lightning-fast inference. Be direct and specific." },
  "chat.groq.com":   { name: "Groq",    hint: "Groq provides lightning-fast inference. Be direct and specific." }
};

function getSiteHint(url) {
  if (!url) return null;
  for (const [domain, ctx] of Object.entries(SITE_HINTS)) {
    if (url.includes(domain)) return ctx;
  }
  return null;
}

// ─── Current Context State ──────────────────────────────────────────────────
let currentScenario = "B"; // default: static text

// ─── Extension Setup ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  buildContextMenu("B"); // default menu
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ─── Dynamic Context Menu Builder ───────────────────────────────────────────
function buildContextMenu(scenario) {
  currentScenario = scenario;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "devlar-action",
      title: "Devlar ✨",
      contexts: ["selection", "editable"]
    });
  });
}

// ─── Listen for Context Updates from content.js ─────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateContextMenu") {
    if (request.scenario !== currentScenario) {
      buildContextMenu(request.scenario);
    }
    sendResponse({ ok: true });
  }
  else if (request.action === "requestStyleChange") {
    processOptimization(
      sender.tab.id,
      request.text,
      request.coords,
      request.mode,
      request.siteContext,
      request.persona
    );
  }
  return true;
});

// ─── Context Menu Click Handler ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "devlar-action") return;

  // Pick default mode based on current scenario
  let mode;
  if (currentScenario === "A") mode = "ai_concise";
  else if (currentScenario === "C") mode = "standard_grammar";
  else if (currentScenario === "D") mode = "chat_standard";
  else mode = "static_concise";

  triggerFromMenu(tab, mode);
});

// ─── Keyboard Shortcut Handler ──────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === "optimize-prompt") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      const defaultMode = currentScenario === "A" 
        ? "ai_concise" 
        : currentScenario === "C" 
          ? "standard_grammar" 
          : currentScenario === "D" 
            ? "chat_standard" 
            : "static_concise";
      triggerFromMenu(tab, defaultMode);
    });
  }
});

// ─── Trigger ────────────────────────────────────────────────────────────────
function triggerFromMenu(tab, mode) {
  if (!tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Could not reach content script:", chrome.runtime.lastError.message);
      return;
    }
    if (response) {
      const text = response.text ? response.text.trim() : "";
      if (!text) {
        chrome.tabs.sendMessage(tab.id, {
          action: "showOverlayError",
          message: "No text detected. Please type something or highlight text inside the box first.",
          coords: response.coords
        });
        return;
      }
      const siteContext = getSiteHint(tab.url);
      processOptimization(tab.id, text, response.coords, mode, siteContext, null);
    }
  });
}

// ─── Orchestration ──────────────────────────────────────────────────────────
function processOptimization(tabId, rawText, coords, mode, siteContext, persona) {
  chrome.storage.local.get(["groqApiKey", "userPersona"], async (result) => {
    const apiKey = result.groqApiKey;
    const resolvedPersona = persona !== undefined ? persona : (result.userPersona || null);

    if (!apiKey) {
      chrome.tabs.sendMessage(tabId, {
        action: "showOverlayError",
        message: "No API Key configured. Click the Devlar icon to set it up.",
        coords
      });
      return;
    }

    // Show loading spinner immediately
    chrome.tabs.sendMessage(tabId, {
      action: "showOverlayLoading",
      coords,
      rawText,
      currentMode: mode,
      siteContext,
      persona: resolvedPersona
    });

    try {
      await streamGroqAPI(apiKey, rawText, mode, siteContext, resolvedPersona, tabId, coords);
    } catch (error) {
      console.error("Groq API call failed:", error);
      chrome.tabs.sendMessage(tabId, {
        action: "showOverlayError",
        message: `Groq API Error: ${error.message}`,
        coords
      });
    }
  });
}

// ─── System Prompt Builder ───────────────────────────────────────────────────
function buildSystemInstruction(mode, siteContext, persona) {
  let block = "";

  switch (mode) {
    // ── Scenario A: AI Prompt Optimization ──
    case "ai_concise":
      block = `You are a world-class prompt engineer specializing in writing sharp, high-signal prompts.
Your job: transform the user's rough input into a SHORT, POWERFUL, and DIRECT prompt.

Rules:
- Strip all filler words, repetition, and vagueness.
- Every word must earn its place. If it doesn't add meaning, cut it.
- Make the goal crystal clear in one or two sentences.
- Add the single most important constraint or context if missing.
- Do NOT use bullet points, headers, or long explanations — just a clean, tight prompt.
- Output ONLY the final prompt text. No preamble, no labels, no code blocks.`;
      break;

    case "ai_expert":
      block = `You are a world-class prompt engineer who specializes in role-based prompting.
Your job: rewrite the user's rough input by assigning a highly specific expert persona to the AI, then detailing the task.

Rules:
- Start with "Act as a [very specific expert title]." — be precise, not generic.
- After the persona, state the task clearly: what is needed, what context matters, and any key constraints.
- Add specific output requirements: format, length, tone, depth.
- Think about edge cases the user might not have considered, and address them.
- Output ONLY the final prompt text. No preamble, no labels, no markdown code blocks.`;
      break;

    case "ai_structured":
      block = `You are a world-class prompt engineer who writes structured, detailed prompts for complex tasks.
Your job: rewrite the user's rough input into a thorough, multi-section prompt using clear markdown headers.

Use EXACTLY this structure (include all sections, never skip one):
**Role:** [Who the AI should be — be specific and authoritative]
**Context:** [Relevant background the AI needs to understand the situation]
**Task:** [Exactly what needs to be done — be specific and unambiguous]
**Requirements:** [Bullet list of key requirements, constraints, or rules]
**Output Format:** [How the response should be structured: format, length, style, tone]

Rules:
- Each section must have meaningful, non-vague content.
- Infer and add details the user implied but didn't explicitly state.
- Output ONLY the final structured prompt text. No preamble, no code blocks.`;
      break;

    // ── Scenario B: Static Text ──
    case "static_concise":
      block = `You are a brilliant language expert.
Your job: provide a CONCISE meaning or summary of the user's highlighted text.

Rules:
- Distill the core meaning into 1–3 clear sentences.
- If it's a single word or phrase, provide a brief definition and usage context.
- If it's a paragraph, summarize the key point.
- Be direct and sharp — no fluff.
- Output ONLY the meaning/summary. No preamble, no labels.`;
      break;

    case "static_explain":
      block = `You are a brilliant educator and language expert.
Your job: provide an IN-DEPTH explanation of the user's highlighted text.

Rules:
- Explain what the text means comprehensively.
- Provide context, background, and any important nuances.
- If it's a technical term, explain it with an analogy or example.
- If it's a paragraph, break down the key ideas and their implications.
- Use clear, accessible language.
- Output ONLY the explanation. No preamble, no labels.`;
      break;

    case "static_grammar":
      block = `You are an expert editor and grammar specialist.
Your job: return a corrected version of the user's text with perfect grammar, spelling, and punctuation.

Rules:
- Fix all grammar, spelling, and punctuation errors.
- Improve sentence flow and readability where needed.
- Preserve the original meaning and tone completely.
- Do NOT add new information or change the intent.
- Output ONLY the corrected text. No preamble, no quotes, no explanations.`;
      break;

    // ── Scenario C: Standard Search Input ──
    case "standard_grammar":
      block = `You are an expert editor. The user typed something into a search box or standard input field.
Your job: fix any grammar, spelling, or punctuation errors. Return the corrected version.

Rules:
- Fix spelling and grammar only.
- Keep it short and direct — this is a search query or short input.
- Preserve the original intent completely.
- Output ONLY the corrected text. Nothing else.`;
      break;

    // ── Scenario D: Chat App ──
    case "chat_standard":
      block = `You are an expert chat editor. The user is writing a message in a chat app to send to someone else.
Your job: return a grammatically corrected version of their draft.

Rules:
- Fix grammar, spelling, and punctuation errors.
- Maintain the original tone, slang, abbreviations, and emojis.
- STRICTLY output ONLY the text the user should send in their chat.
- NEVER add explanations, meta-commentary, or talk to the user (e.g., do NOT say "I didn't understand...", do NOT add notes, do NOT ask questions about gibberish).
- If the user writes gibberish or unresolvable typos, preserve those exact parts as-is. Do NOT translate or explain them.
- Output absolutely nothing except the corrected draft message. No quotes, no preamble, no commentary.`;
      break;

    default:
      block = "You are a helpful assistant. Improve the user's text.";
  }


  
  // Inject user persona if available
  let personaBlock = "";
  if (persona && persona.trim()) {
    personaBlock = `\n\n---\nIMPORTANT CONTEXT ABOUT THE USER:\n${persona.trim()}\nUse this to make the output more relevant and useful for this particular user.`;
  }

  // Inject site-specific tailoring for AI sites
  let siteBlock = "";
  if (siteContext && mode.startsWith("ai_")) {
    siteBlock = `\n\n---\nTARGET AI PLATFORM: ${siteContext.name}\n${siteContext.hint}\nSubtly tailor the language and phrasing to work best on this specific platform.`;
  }

  return block + personaBlock + siteBlock;
}

// ─── Streaming API Call with Fallback ────────────────────────────────────────
async function streamGroqAPI(apiKey, promptText, mode, siteContext, persona, tabId, coords) {
  const modelsToTry = [
    "llama-3.3-70b-versatile",
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
  ];

  const systemInstructionText = buildSystemInstruction(mode, siteContext, persona);

  let response = null;

  for (const model of modelsToTry) {
    const url = "https://api.groq.com/openai/v1/chat/completions";

    const payload = {
      model: model,
      messages: [
        { role: "system", content: systemInstructionText },
        { role: "user", content: promptText }
      ],
      temperature: 0.7,
      stream: true
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        response = res;
        break;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn(`${model} failed:`, errData.error?.message || `HTTP ${res.status}`);
        if (model === modelsToTry[modelsToTry.length - 1]) {
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }
      }
    } catch (e) {
      console.warn(`Error connecting to ${model}:`, e);
      if (model === modelsToTry[modelsToTry.length - 1]) {
        throw e;
      }
    }
  }

  // Switch overlay to streaming state
  chrome.tabs.sendMessage(tabId, {
    action: "showOverlayStreamStart",
    rawText: promptText,
    currentMode: mode,
    coords,
    siteContext,
    persona
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          chrome.tabs.sendMessage(tabId, {
            action: "appendStreamChunk",
            fullText
          });
        }
      } catch (e) {
        // Partial JSON — skip
      }
    }
  }

  // Signal stream is complete
  chrome.tabs.sendMessage(tabId, {
    action: "showOverlayStreamComplete",
    fullText,
    rawText: promptText,
    currentMode: mode,
    coords,
    siteContext,
    persona
  });
}