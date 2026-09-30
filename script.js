"use strict";

// Change this if your FastAPI server runs elsewhere.
const API_URL = import.meta.env.VITE_BACKEND_URL;
const TIMEOUT_MS = 20000;
const MAX_SCORE = 10; // assumed scale of the model's output

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const states = ["idle", "loading", "result", "error"].reduce((acc, name) => {
  acc[name] = document.getElementById(`state-${name}`);
  return acc;
}, {});

// Validation rules mirror the Pydantic StudentData model.
const fields = {
  age:                     { type: "int",   min: 10, max: 100, label: "Age" },
  gender:                  { type: "text",  label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "text",  label: "Academic level" },
  most_used_platform:      { type: "text",  label: "Platform" },
  purpose_of_use:          { type: "text",  label: "Purpose" },
  avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   min: 0, label: "Phone unlocks" },
  study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", min: 0, max: 24, label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", min: 2, max: 24, label: "Sleep hours" },
  stress_level:            { type: "text",  label: "Stress level" },
};

function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
}

function setFieldError(name, message) {
  const input = form.elements[name];
  const slot = form.querySelector(`.error[data-for="${name}"]`);
  if (!input || !slot) return;
  slot.textContent = message || "";
  input.classList.toggle("invalid", Boolean(message));
}

function clearErrors() {
  Object.keys(fields).forEach((name) => setFieldError(name, ""));
}

function validate() {
  const payload = {};
  let firstInvalid = null;

  for (const [name, rule] of Object.entries(fields)) {
    const raw = form.elements[name].value.trim();
    let message = "";

    if (raw === "") {
      message = `${rule.label} is required.`;
    } else if (rule.type === "text") {
      payload[name] = raw;
    } else {
      const value = Number(raw);
      if (Number.isNaN(value)) message = "Enter a valid number.";
      else if (rule.type === "int" && !Number.isInteger(value)) message = "Enter a whole number.";
      else if (rule.min !== undefined && value < rule.min) message = `Must be ${rule.min} or more.`;
      else if (rule.max !== undefined && value > rule.max) message = `Must be ${rule.max} or less.`;
      else payload[name] = value;
    }

    setFieldError(name, message);
    if (message && !firstInvalid) firstInvalid = form.elements[name];
  }

  if (firstInvalid) { firstInvalid.focus(); return null; }
  return payload;
}

// Turn FastAPI's 422 detail array into readable lines.
function formatValidationErrors(detail) {
  if (!Array.isArray(detail)) return [String(detail)];
  return detail.map((d) => {
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "field";
    if (fields[field]) setFieldError(field, d.msg);
    return `${fields[field]?.label || field}: ${d.msg}`;
  });
}

function showError(title, message, list = []) {
  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;
  const ul = document.getElementById("error-list");
  ul.innerHTML = "";
  list.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    ul.appendChild(li);
  });
  showState("error");
}

function describeScore(score) {
  const ratio = score / MAX_SCORE;
  if (ratio >= 0.7) return { color: "var(--good)", title: "Healthy range", text: "The habits entered are associated with a strong mental health score." };
  if (ratio >= 0.5) return { color: "var(--mid)", title: "Moderate range", text: "The score is mid-range. Sleep, activity and screen time are the habits most worth reviewing." };
  return { color: "var(--low)", title: "Needs attention", text: "The score is low. Reducing screen time and improving sleep may help, and support is worth considering." };
}

function showResult(score) {
  const info = describeScore(score);
  const fill = document.getElementById("dial-fill");
  const valueEl = document.getElementById("score-value");

  document.getElementById("score-title").textContent = info.title;
  document.getElementById("score-text").textContent = info.text;
  fill.style.stroke = info.color;
  fill.style.strokeDashoffset = 100;
  valueEl.textContent = "0.0";
  showState("result");

  const pct = Math.max(0, Math.min(1, score / MAX_SCORE)) * 100;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.strokeDashoffset = 100 - pct;
  }));

  // Count up the number alongside the dial.
  const start = performance.now();
  const duration = 1000;
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    valueEl.textContent = (score * (1 - Math.pow(1 - t, 3))).toFixed(1);
    if (t < 1) requestAnimationFrame(tick);
    else valueEl.textContent = score.toFixed(1);
  })(start);
}

async function predict(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let data = null;
    try { data = await response.json(); } catch { /* non-JSON body */ }

    if (response.status === 422) {
      showError("Check your inputs", "The server rejected some values.", formatValidationErrors(data?.detail));
      return;
    }
    if (!response.ok) {
      showError(`Server error (${response.status})`, "The model could not process this request. Please try again in a moment.");
      return;
    }
    const score = data?.predict_mental_health_score;
    if (typeof score !== "number") {
      showError("Unexpected response", "The server returned data in an unknown format.");
      return;
    }
    showResult(score);
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out", "The server took too long to respond. Please try again.");
    } else {
      showError("Cannot reach the server", `Make sure the FastAPI backend is running at ${API_URL}.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  const payload = validate();
  if (!payload) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Predicting...";
  showState("loading");

  await predict(payload);

  submitBtn.disabled = false;
  submitBtn.textContent = "Predict score";
});

form.addEventListener("reset", () => { clearErrors(); showState("idle"); });

form.addEventListener("input", (event) => {
  if (event.target.name) setFieldError(event.target.name, "");
});

document.getElementById("retry-btn").addEventListener("click", () => showState("idle"));
