console.log("Devlar background service worker loaded.");

// ─── Extension Setup ────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ─── Listen for Context Updates from content.js ─────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "requestStyleChange") {
    processOptimization(
      sender.tab.id,
      request.text,
      request.coords,
      request.mode,
      request.persona
    );
  }
  return true;
});

// ─── Keyboard Shortcut Handler ──────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === "optimize-prompt") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      triggerOptimization(tab);
    });
  }
});

// ─── Trigger Processing ─────────────────────────────────────────────────────
function triggerOptimization(tab) {
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
          message: "No text detected. Please type something or highlight text first.",
          coords: response.coords
        });
        return;
      }

      // Default mode when first opening the interface is Summarize
      const defaultMode = "summarize";
      processOptimization(tab.id, text, response.coords, defaultMode, null);
    }
  });
}

// ─── Orchestration ──────────────────────────────────────────────────────────
function processOptimization(tabId, rawText, coords, mode, persona) {
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
      persona: resolvedPersona
    });

    try {
      await streamGroqAPI(apiKey, rawText, mode, resolvedPersona, tabId, coords);
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
function buildSystemInstruction(mode, persona) {
  let block = "";

  switch (mode) {
    case "summarize":
      block = `You are an expert content summarizer.
Your job: provide a highly concise summary of the highlighted text.

Rules:
- Distill the core meaning of the selection into a few clear sentences.
- The summary must be brief, direct, and strictly limited to a maximum of 6-7 lines of output.
- Output ONLY the summary. No preamble, no labels.`;
      break;

    case "prompt_engineer":
      block = `You are a world-class prompt engineer who specializes in structuring precise prompts.
Your job: rewrite the user's input into a highly structured prompt to achieve the best results on LLMs like ChatGPT, Gemini, or Claude.

Rules:
- Carefully frame the input text, adding explicit instructions, target output formats, or constraints.
- Avoid hallucinating new context. The generated prompt must remain tightly relevant to the user's selected text.
- Keep the output clear, direct, and well-structured.
- Output ONLY the optimized prompt text. No preamble, no labels, no markdown code blocks.`;
      break;

    case "query_refiner":
      block = `You are an expert search engine query optimizer.
Your job: correct typing errors, spelling, and grammar in the user's text while strictly preserving the original search intent.

Rules:
- Keep it brief — this is a search query or a light edit.
- Refine the text without altering its core meaning.
- Output ONLY the corrected text. No preamble, no explanations.`;
      break;

    case "explain":
      block = `You are a supportive and clear educator and technical tutor.
Your job: provide a comprehensive explanation of the selected text or key technical terms.

Rules:
- Explain the concepts as if you are tutoring a student.
- Break down technical keywords or complex phrases with simple analogies, structured points, or clear examples where appropriate.
- Make the explanation accessible, highly informative, and easy to understand.
- Output ONLY the explanation. No preamble, no labels.`;
      break;

    case "standardize":
      block = `You are an expert editor and software engineer.
Your job: analyze the user's text and return a corrected version.

Rules:
- If the input is natural language, correct spelling, grammar, punctuation, and flow to the highest standard of English while preserving meaning.
- If the input is programming code (in any programming language), identify and fix simple logical mistakes, syntax errors, typos, or formatting bugs while keeping the original functional intent.
- Output ONLY the corrected text or corrected code. No explanations, no preamble, no markdown code blocks.`;
      break;

    default:
      block = "You are a helpful assistant. Improve the user's text.";
  }

  // Inject user persona context if configured
  if (persona && persona.trim()) {
    block += `\n\n---\nIMPORTANT CONTEXT ABOUT THE USER:\n${persona.trim()}\nUse this context to make the output highly relevant and useful for this specific user's background.`;
  }

  return block;
}

// ─── Streaming API Call with Fallback ────────────────────────────────────────
async function streamGroqAPI(apiKey, promptText, mode, persona, tabId, coords) {
  const modelsToTry = [
    "llama-3.3-70b-versatile",
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
  ];

  const systemInstructionText = buildSystemInstruction(mode, persona);
  let response = null;

  for (const model of modelsToTry) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const payload = {
      model: model,
      messages: [
        { role: "system", content: systemInstructionText },
        { role: "user", content: promptText }
      ],
      temperature: 0.2, // Low temperature for high precision and low hallucination
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
        // Partial JSON chunk
      }
    }
  }

  // Signal stream completion
  chrome.tabs.sendMessage(tabId, {
    action: "showOverlayStreamComplete",
    fullText,
    rawText: promptText,
    currentMode: mode,
    coords,
    persona
  });
}