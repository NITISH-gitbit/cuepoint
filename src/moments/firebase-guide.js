(function () {
  "use strict";

  const PROGRESS_KEY = "cuepoint:firebaseGuideCompleted";
  const TOTAL_STEPS = 5;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const RTDB_RULES = JSON.stringify(
    {
      rules: {
        users: {
          $uid: {
            ".read": "auth != null && auth.uid == $uid",
            ".write": "auth != null && auth.uid == $uid",
            cuepointV2: {
              videos: {
                $videoId: {
                  ".validate": "newData.child('videoId').val() == $videoId && newData.child('revision').isNumber() && newData.child('revision').val() >= 0",
                },
              },
            },
          },
        },
      },
    },
    null,
    2,
  );

  function makeSvgIcon(symbolId) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "g-icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${symbolId}`);
    svg.appendChild(use);
    return svg;
  }

  function renderHighlightedJson(target, jsonText) {
    const frag = document.createDocumentFragment();
    const tokenRe = /("(?:\\.|[^"\\])*")(\s*:)?|([{}[\],:])/g;
    let cursor = 0;
    let match;

    while ((match = tokenRe.exec(jsonText)) !== null) {
      if (match.index > cursor) {
        frag.appendChild(document.createTextNode(jsonText.slice(cursor, match.index)));
      }
      if (match[1] !== undefined) {
        const span = document.createElement("span");
        span.className = match[2] ? "tok-key" : "tok-str";
        span.textContent = match[1];
        frag.appendChild(span);
        if (match[2]) {
          const colon = document.createElement("span");
          colon.className = "tok-punc";
          colon.textContent = match[2];
          frag.appendChild(colon);
        }
      } else if (match[3] !== undefined) {
        const punc = document.createElement("span");
        punc.className = "tok-punc";
        punc.textContent = match[3];
        frag.appendChild(punc);
      }
      cursor = tokenRe.lastIndex;
    }

    if (cursor < jsonText.length) {
      frag.appendChild(document.createTextNode(jsonText.slice(cursor)));
    }
    target.replaceChildren(frag);
  }

  function loadCompleted() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_STEPS));
    } catch {
      return new Set();
    }
  }

  function saveCompleted(completed) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify([...completed].sort((a, b) => a - b)));
    } catch {
      // Storage may be unavailable; progress still works in memory for this session.
    }
  }

  const codeEl = document.getElementById("rulesCode");
  const copyBtn = document.getElementById("copyRulesBtn");
  const copyLabel = document.getElementById("copyRulesLabel");
  const progressRow = document.getElementById("progressRow");
  const progressCountEl = document.getElementById("progressCount");
  const resetBtn = document.getElementById("resetProgressBtn");
  const testerEl = document.getElementById("snippetTester");
  const testerResultEl = document.getElementById("snippetTesterResult");

  if (codeEl) renderHighlightedJson(codeEl, RTDB_RULES);

  if (copyBtn && copyLabel) {
    let copyTimer = null;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(RTDB_RULES);
        copyLabel.textContent = "Copied";
        copyBtn.classList.add("is-copied");
        const iconUse = copyBtn.querySelector("use");
        if (iconUse) iconUse.setAttribute("href", "#g-check");
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          copyTimer = null;
          copyLabel.textContent = "Copy rules";
          copyBtn.classList.remove("is-copied");
          if (iconUse) iconUse.setAttribute("href", "#g-copy");
        }, 1600);
      } catch {
        window.prompt("Copy Firebase RTDB Security Rules:", RTDB_RULES);
      }
    });
  }

  // ---------- Gutter Detent Checkoff & Cue-Track Sync ----------
  const completed = loadCompleted();
  const defaultGutterLabels = new Map();
  for (const el of document.querySelectorAll("[data-gutter-label]")) {
    defaultGutterLabels.set(Number(el.dataset.gutterLabel), el.textContent);
  }

  function syncChecklistUi() {
    const count = completed.size;
    if (progressRow) progressRow.classList.toggle("has-done", count > 0);
    if (progressCountEl) progressCountEl.textContent = `${count} / ${TOTAL_STEPS} done`;
    if (resetBtn) resetBtn.hidden = count === 0;

    for (let step = 1; step <= TOTAL_STEPS; step++) {
      const done = completed.has(step);
      const padded = String(step).padStart(2, "0");
      const section = document.querySelector(`.cue-step[data-step="${step}"]`);
      const toggle = document.querySelector(`[data-check-step="${step}"]`);
      const detentNum = document.querySelector(`[data-detent-num="${step}"]`);
      const cueLink = document.querySelector(`[data-cue-step="${step}"]`);
      const cueNum = document.querySelector(`[data-cue-num="${step}"]`);
      const label = document.querySelector(`[data-gutter-label="${step}"]`);

      if (section) section.classList.toggle("is-done", done);
      if (toggle) toggle.setAttribute("aria-pressed", String(done));
      if (detentNum) {
        detentNum.replaceChildren(done ? makeSvgIcon("g-check") : document.createTextNode(padded));
      }
      if (cueLink) cueLink.classList.toggle("is-done", done);
      if (cueNum) {
        cueNum.replaceChildren(done ? makeSvgIcon("g-check") : document.createTextNode(padded));
      }
      if (label) {
        label.textContent = done ? "Done" : defaultGutterLabels.get(step) || "";
      }
    }
  }

  for (const btn of document.querySelectorAll("[data-check-step]")) {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.checkStep);
      if (completed.has(step)) completed.delete(step);
      else completed.add(step);
      saveCompleted(completed);
      syncChecklistUi();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      completed.clear();
      saveCompleted(completed);
      syncChecklistUi();
    });
  }

  syncChecklistUi();

  // ---------- Cue-Track Scroll-Spy ----------
  if (typeof YTM !== "undefined" && YTM.sectionTrack) {
    YTM.sectionTrack.initSectionTrack({
      trackSelector: ".cue-track",
      trackWrapSelector: ".cue-track-wrap",
      linkSelector: "[data-cue-step]",
      currentAttr: "step",
    });
  }

  // ---------- Local-Only Firebase Config Snippet Verifier ----------
  if (testerEl && testerResultEl && typeof YTM !== "undefined" && YTM.firebaseAuth) {
    testerEl.addEventListener("input", () => {
      const raw = testerEl.value;
      if (!raw.trim()) {
        testerResultEl.hidden = true;
        return;
      }
      const parsed = YTM.firebaseAuth.parseFirebaseConfigSnippet(raw);
      testerResultEl.hidden = false;

      if (parsed.apiKey && parsed.databaseURL) {
        const host = new URL(parsed.databaseURL).host;
        testerResultEl.className = "cue-verifier__result cue-verifier__result--ok";
        testerResultEl.textContent = `Ready to connect — apiKey and databaseURL (${host}) detected.`;
      } else if (parsed.apiKey) {
        testerResultEl.className = "cue-verifier__result cue-verifier__result--warn";
        testerResultEl.textContent = "apiKey detected, but databaseURL is missing — also paste your Step 3 Realtime Database URL in CuePoint.";
      } else {
        testerResultEl.className = "cue-verifier__result cue-verifier__result--warn";
        testerResultEl.textContent = "Could not find apiKey and databaseURL. Copy the full const firebaseConfig = { ... }; block from Project Settings.";
      }
    });
  }
})();
