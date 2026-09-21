let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;

const AGENT_LABELS = {
  flight_agent: "✈️ Flight Agent",
  hotel_agent: "🏨 Hotel Agent",
  weather_agent: "🌦️ Weather Agent",
  budget_agent: "💰 Budget Agent",
  itinerary_agent: "🗓️ Itinerary Agent"
};

// Order matches the LangGraph backend routing
const AGENT_ORDER = [
  "supervisor", "flight_agent", "hotel_agent",
  "weather_agent", "budget_agent", "itinerary_agent",
  "human_approval", "final_agent"
];

function setPrompt(text) {
  document.getElementById("userInput").value = text;
}

function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");
  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  sendBtn.disabled = isLoading;
  approveBtn.disabled = isLoading;
  reviseBtn.disabled = isLoading;

  if (isLoading && mode === "draft") {
    btnText.classList.add("hidden");
    btnLoader.classList.remove("hidden");
  } else {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
  }
}

function showError(message) {
  const errorBox = document.getElementById("errorBox");
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  if (!errorBox) return;
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function renderMarkdown(element, markdown) {
  if (typeof marked !== "undefined") {
    element.innerHTML = marked.parse(markdown || "");
  } else {
    element.innerText = markdown || "";
  }
}

function showWorkflow(data) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  if (!section || !reasoning || !chips || !guardrailBadge) return;

  reasoning.textContent = data.supervisor_reasoning || "Supervisor routing completed.";
  chips.innerHTML = "";

  (data.selected_agents || []).forEach((agent) => {
    const chip = document.createElement("span");
    chip.className = "agent-chip";
    chip.textContent = AGENT_LABELS[agent] || agent;
    chips.appendChild(chip);
  });

  if (data.guardrail_allowed === false) {
    guardrailBadge.textContent = "Guardrail blocked";
    guardrailBadge.classList.add("blocked");
  } else {
    guardrailBadge.textContent = "Guardrail passed";
    guardrailBadge.classList.remove("blocked");
  }

  section.classList.remove("hidden");
}

// ---------- Sidebar: agent trace ----------
function updateAgentTrace(selectedAgents, upToStep) {
  const relevant = ["supervisor", ...(selectedAgents || []), "human_approval", "final_agent"];
  document.querySelectorAll(".agent-trace li").forEach((li) => {
    const agent = li.dataset.agent;
    li.classList.remove("active", "done");
    if (!relevant.includes(agent)) {
      li.style.opacity = "0.35";
      return;
    }
    li.style.opacity = "1";
    const idx = relevant.indexOf(agent);
    const upToIdx = relevant.indexOf(upToStep);
    if (idx < upToIdx) li.classList.add("done");
    else if (idx === upToIdx) li.classList.add("active");
  });
}

function resetAgentTrace() {
  document.querySelectorAll(".agent-trace li").forEach((li) => {
    li.classList.remove("active", "done");
    li.style.opacity = "1";
  });
}

// ---------- Sidebar: trip constraints ----------
function updateConstraints(constraints) {
  const box = document.getElementById("constraintsBox");
  if (!box) return;
  if (!constraints || Object.keys(constraints).length === 0) {
    box.innerHTML = `<p class="muted">No trip data yet.</p>`;
    return;
  }
  const rows = Object.entries(constraints)
    .filter(([, v]) => v && (Array.isArray(v) ? v.length : true))
    .map(([k, v]) => {
      const label = k.replace(/_/g, " ");
      const value = Array.isArray(v) ? v.join(", ") : v;
      return `<div class="row"><span>${label}</span><span>${value}</span></div>`;
    })
    .join("");
  box.innerHTML = rows || `<p class="muted">No trip data yet.</p>`;
}

function updateThreadDisplay(threadId) {
  const el = document.getElementById("threadIdDisplay") ||
    document.getElementById("threadInfo");
  if (!el) return;
  el.textContent = threadId ? threadId.slice(0, 18) + "…" : "—";
}

function startNewSession() {
  currentThreadId = null;
  localStorage.removeItem("travel_thread_id");
  latestAnswerMarkdown = "";
  waitingForApproval = false;

  updateThreadDisplay(null);
  updateConstraints(null);
  resetAgentTrace();
  hideError();
  hideApproval();

  document.getElementById("workflowSection").classList.add("hidden");
  document.getElementById("resultSection").classList.add("hidden");
  document.getElementById("userInput").value = "";
  document.getElementById("userInput").focus();
}

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  if (!resultSection || !resultBox || !threadInfo || !resultTitle) return;

  renderMarkdown(resultBox, latestAnswerMarkdown);
  threadInfo.textContent = `Thread ID: ${threadId}`;
  resultTitle.textContent = isDraft ? "Draft Travel Plan" : "Your Final AI Travel Plan";
  resultSection.classList.remove("hidden");

  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");
  if (!section || !approvalRequest) return;
  approvalRequest.textContent = data.approval_request ||
    "Approve the draft or provide feedback before the final plan is generated.";
  section.classList.remove("hidden");
}

function hideApproval() {
  waitingForApproval = false;
  document.getElementById("approvalSection").classList.add("hidden");
  document.getElementById("approvalFeedback").value = "";
}

async function sendMessage() {
  hideError();

  if (waitingForApproval) {
    showError("Please approve or revise the current draft before starting another plan.");
    return;
  }

  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (!message) {
    showError("Please enter your travel request first.");
    return;
  }

  setLoading(true, "draft");
  updateAgentTrace([], "supervisor");

  try {
    const response = await fetch("/api/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, thread_id: currentThreadId })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Something went wrong.");
    }

    currentThreadId = data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);
    updateThreadDisplay(currentThreadId);
    updateConstraints(data.trip_constraints);

    showWorkflow(data);

    if (!data.guardrail_allowed) {
      resetAgentTrace();
      showResult(data.answer, data.thread_id, false);
      return;
    }

    if (data.requires_approval) {
      updateAgentTrace(data.selected_agents, "human_approval");
      showResult(data.itinerary || data.answer, data.thread_id, true);
      showApproval(data);
    } else {
      updateAgentTrace(data.selected_agents, "final_agent");
      hideApproval();
      showResult(data.answer, data.thread_id, false);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "draft");
  }
}

async function submitApproval(approved) {
  hideError();

  if (!currentThreadId || !waitingForApproval) {
    showError("There is no draft waiting for approval.");
    return;
  }

  const feedbackInput = document.getElementById("approvalFeedback");
  const feedback = feedbackInput.value.trim();

  if (!approved && !feedback) {
    showError("Please enter revision feedback before requesting changes.");
    feedbackInput.focus();
    return;
  }

  setLoading(true, "approval");

  try {
    const response = await fetch("/api/travel/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Could not resume the travel workflow.");
    }

    showWorkflow(data);
    updateConstraints(data.trip_constraints);
    updateAgentTrace(data.selected_agents, "final_agent");
    hideApproval();
    showResult(data.answer, data.thread_id, false);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "approval");
  }
}

function copyResult() {
  const resultBox = document.getElementById("resultBox");
  const text = resultBox.innerText;
  if (!text) return;

  navigator.clipboard.writeText(text)
    .then(() => {
      const copyBtn = document.querySelector(".copy-btn");
      if (!copyBtn) return;
      const oldText = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = oldText; }, 1400);
    })
    .catch(() => showError("Could not copy result."));
}

function downloadPDF() {
  const pdfContent = document.getElementById("pdfContent");

  if (!latestAnswerMarkdown || !pdfContent) {
    showError("No travel plan available to download.");
    return;
  }

  const downloadBtn = document.querySelector(".download-btn");
  if (!downloadBtn) {
    showError("Download control is unavailable.");
    return;
  }
  const oldText = downloadBtn.textContent;
  downloadBtn.textContent = "Preparing PDF...";
  downloadBtn.disabled = true;

  const options = {
    margin: 0.5,
    filename: "ai-travel-plan.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
    jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] }
  };

  html2pdf()
    .set(options)
    .from(pdfContent)
    .save()
    .then(() => {
      downloadBtn.textContent = oldText;
      downloadBtn.disabled = false;
    })
    .catch(() => {
      downloadBtn.textContent = oldText;
      downloadBtn.disabled = false;
      showError("Could not download PDF.");
    });
}

document.addEventListener("keydown", function (event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});