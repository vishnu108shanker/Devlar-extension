document.addEventListener("DOMContentLoaded", () => {
  // ── API Key Elements
  const apiKeyInput    = document.getElementById("apiKey");
  const toggleBtn      = document.getElementById("togglePassword");
  const testBtn        = document.getElementById("testBtn");
  const saveBtn        = document.getElementById("saveBtn");
  const statusMsg      = document.getElementById("statusMessage");

  // ── Persona Elements
  const personaInput   = document.getElementById("userPersona");
  const savePersonaBtn = document.getElementById("savePersonaBtn");
  const personaStatus  = document.getElementById("personaStatus");

  // ── Load saved values and set initial button states
  chrome.storage.local.get(["groqApiKey", "userPersona"], (result) => {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
      saveBtn.textContent = "Update Key";
      showStatus(statusMsg, "API key is active ✓", "success");
    }
    if (result.userPersona) {
      personaInput.value = result.userPersona;
      savePersonaBtn.textContent = "Update Profile";
      showStatus(personaStatus, "Profile active — all prompts are personalized ✓", "success");
    }
  });

  // ── Toggle API key visibility
  toggleBtn.addEventListener("click", () => {
    const show = apiKeyInput.type === "password";
    apiKeyInput.type = show ? "text" : "password";
    toggleBtn.textContent = show ? "🙈" : "👁️";
  });

  // ── Test Key
  testBtn.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    if (!key) { showStatus(statusMsg, "Please enter an API key first.", "error"); return; }
    showStatus(statusMsg, "Testing connection...", "loading");
    setBtnsDisabled(true);
    try {
      await pingGroq(key);
      showStatus(statusMsg, "Connection successful! Key is valid ✨", "success");
    } catch (e) {
      showStatus(statusMsg, `Validation failed: ${e.message}`, "error");
    } finally {
      setBtnsDisabled(false);
    }
  });

  // ── Save / Update Key
  saveBtn.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();

    // Clear key if input is empty
    if (!key) {
      chrome.storage.local.remove(["groqApiKey"]);
      saveBtn.textContent = "Save Key";
      showStatus(statusMsg, "API key removed.", "success");
      return;
    }

    showStatus(statusMsg, "Validating key before saving...", "loading");
    setBtnsDisabled(true);
    try {
      await pingGroq(key);
      chrome.storage.local.set({ groqApiKey: key }, () => {
        saveBtn.textContent = "Update Key";
        showStatus(statusMsg, "API key saved and validated! ✨", "success");
      });
    } catch (e) {
      showStatus(statusMsg, `Could not save: ${e.message}`, "error");
    } finally {
      setBtnsDisabled(false);
    }
  });

  // ── Save / Update Persona
  savePersonaBtn.addEventListener("click", () => {
    const persona = personaInput.value.trim();

    if (!persona) {
      chrome.storage.local.remove(["userPersona"]);
      savePersonaBtn.textContent = "Save Profile";
      showStatus(personaStatus, "Profile cleared.", "success");
      return;
    }

    chrome.storage.local.set({ userPersona: persona }, () => {
      savePersonaBtn.textContent = "Update Profile";
      showStatus(personaStatus, "Profile saved! Every prompt is now personalized to you ✨", "success");
    });
  });

  // ── Helpers
  async function pingGroq(key) {
    const url = `https://api.groq.com/openai/v1/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({ 
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Reply with OK only." }] 
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
  }

  function showStatus(el, message, type) {
    el.textContent = message;
    el.className = "status-indicator";
    if (type) el.classList.add(`status-${type}`);
  }

  function setBtnsDisabled(disabled) {
    testBtn.disabled = disabled;
    saveBtn.disabled = disabled;
  }
});
