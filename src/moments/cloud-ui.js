var YTM = YTM || {};

(function () {
  "use strict";

  const { messages, firebaseAuth, momentsRender, schema } = YTM;
  const { el } = momentsRender;
  const { ACTIONS } = messages;
  const ext = messages.getExtApi();

  const CLOUD_ORIGINS = [
    "https://identitytoolkit.googleapis.com/*",
    "https://securetoken.googleapis.com/*",
    "https://*.firebaseio.com/*",
    "https://*.firebasedatabase.app/*",
  ];

  function initCloudUi(onLibraryChange) {
    const cloudBtn = document.getElementById("cloudBtn");
    const cloudDot = document.getElementById("cloudDot");
    const cloudLabel = document.getElementById("cloudBtnLabel");
    const pop = document.getElementById("cloudPopover");

    if (!cloudBtn || !pop) return;

    const modeLocalBtn = document.getElementById("cloudModeLocal");
    const modeCloudBtn = document.getElementById("cloudModeCloud");
    const localPane = document.getElementById("cloudLocalPane");
    const localResumeHint = document.getElementById("cloudLocalResumeHint");
    const setupPane = document.getElementById("cloudSetupPane");
    const connectedPane = document.getElementById("cloudConnectedPane");

    const snippetEl = document.getElementById("cloudSnippet");
    const configStatusEl = document.getElementById("cloudConfigStatus");
    const dbUrlFallbackWrap = document.getElementById("cloudDbUrlFallbackWrap");
    const dbUrlEl = document.getElementById("cloudDbUrl");
    const emailEl = document.getElementById("cloudEmail");
    const passEl = document.getElementById("cloudPassword");
    const signInBtn = document.getElementById("cloudSignIn");
    const guideBtn = document.getElementById("cloudGuideBtn");

    const connEmailEl = document.getElementById("cloudConnEmail");
    const connDbEl = document.getElementById("cloudConnDb");
    const connStateEl = document.getElementById("cloudConnState");
    const syncNowBtn = document.getElementById("cloudSyncNow");
    const syncMsgEl = document.getElementById("cloudSyncMsg");
    const signOutBtn = document.getElementById("cloudSignOut");
    const pausedSignOutBtn = document.getElementById("cloudPausedSignOut");
    const importLocalBtn = document.getElementById("cloudImportLocal");
    const pendingEl = document.getElementById("cloudPending");
    const conflictsEl = document.getElementById("cloudConflicts");
    const conflictList = document.getElementById("cloudConflictList");
    const cloudErrEl = document.getElementById("cloudErr");

    const operationButtons = [modeLocalBtn, modeCloudBtn, signInBtn, signOutBtn,
      pausedSignOutBtn, syncNowBtn, importLocalBtn];
    let currentStatus = { mode: "local", state: "local", hasCredentials: false };
    let parsedConfig = { apiKey: "", databaseURL: "", projectId: "", valid: false };
    let statusSequence = 0;
    let conflictSignature = null;
    let busy = false;

    function setError(msg) {
      cloudErrEl.textContent = msg || "";
      cloudErrEl.hidden = !msg;
    }

    function updateParsedPreview() {
      const raw = snippetEl.value;
      parsedConfig = firebaseAuth
        ? firebaseAuth.parseFirebaseConfigSnippet(raw)
        : { apiKey: "", databaseURL: "", projectId: "", valid: false };

      if (!raw.trim()) {
        configStatusEl.hidden = true;
        dbUrlFallbackWrap.hidden = true;
        return;
      }

      const effectiveDbUrl =
        parsedConfig.databaseURL ||
        (firebaseAuth ? firebaseAuth.normalizeDatabaseUrl(dbUrlEl.value) : "");

      configStatusEl.hidden = false;
      if (parsedConfig.apiKey && effectiveDbUrl) {
        const host = new URL(effectiveDbUrl).host;
        configStatusEl.className = "cloud-config-status cloud-config-status--ok";
        configStatusEl.textContent = `✓ Config detected (${host})`;
        dbUrlFallbackWrap.hidden = !!parsedConfig.databaseURL;
      } else if (parsedConfig.apiKey && !effectiveDbUrl) {
        configStatusEl.className = "cloud-config-status cloud-config-status--warn";
        configStatusEl.textContent =
          "apiKey detected, but databaseURL is missing — paste your RTDB URL below:";
        dbUrlFallbackWrap.hidden = false;
      } else {
        configStatusEl.className = "cloud-config-status cloud-config-status--warn";
        configStatusEl.textContent =
          "Could not find apiKey & databaseURL. Paste the full firebaseConfig = { ... } block.";
        dbUrlFallbackWrap.hidden = true;
      }
    }

    function updateButtons() {
      const disabled = busy || !currentStatus.libraryKey;
      for (const btn of operationButtons) btn.disabled = disabled;
      for (const btn of conflictList.querySelectorAll("[data-mutates]")) btn.disabled = disabled;
    }

    function applyStatus(status) {
      const previous = currentStatus;
      currentStatus = status || { mode: "local", state: "local" };
      const { mode, libraryKey, pendingCount = 0 } = currentStatus;
      const isCloud = mode === "cloud";
      const state = currentStatus.state || "local";
      const conflictCount = currentStatus.conflictCount ?? currentStatus.conflicts?.length ?? 0;
      const cachedConflicts = previous.libraryKey === libraryKey && previous.conflicts?.length === conflictCount
        ? previous.conflicts : [];
      const conflicts = Array.isArray(currentStatus.conflicts) ? currentStatus.conflicts : cachedConflicts;
      currentStatus = { ...currentStatus, conflicts, conflictCount };
      if (previous.libraryKey !== libraryKey || previous.mode !== mode || state === "error") {
        syncMsgEl.hidden = true;
      }
      onLibraryChange(typeof libraryKey === "string" && libraryKey ? libraryKey : null,
        isCloud && currentStatus.hasCredentials);

      cloudDot.className = "cloud-dot cloud-dot--" + (isCloud ? state : "local");
      let label = isCloud ? "Cloud" : "Local";
      if (isCloud && state === "error") label = "Sync Error";
      else if (conflictCount) label = `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`;
      else if (pendingCount > 0) label = `${pendingCount} pending`;
      else if (isCloud && state === "live") label = "Live";
      else if (isCloud && state === "connecting") label = "Syncing…";
      cloudLabel.textContent = label;
      cloudBtn.setAttribute("aria-label", `Storage and sync: ${label}`);
      pendingEl.hidden = !(pendingCount > 0);
      pendingEl.textContent = pendingCount > 0
        ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync.`
        : "";
      renderConflicts(libraryKey, conflicts);
      updateButtons();

      modeLocalBtn.classList.toggle("active", !isCloud);
      modeCloudBtn.classList.toggle("active", isCloud);
      modeLocalBtn.setAttribute("aria-pressed", String(!isCloud));
      modeCloudBtn.setAttribute("aria-pressed", String(isCloud));

      if (!isCloud) {
        localPane.hidden = false;
        setupPane.hidden = true;
        connectedPane.hidden = true;
        if (localResumeHint) {
          localResumeHint.hidden = !currentStatus.hasCredentials;
        }
      } else if (currentStatus.hasCredentials) {
        localPane.hidden = true;
        setupPane.hidden = true;
        connectedPane.hidden = false;
        connEmailEl.textContent = currentStatus.email || "Signed in";
        connDbEl.textContent = currentStatus.databaseURL || "";
        const syncTime = currentStatus.lastSyncedAt
          ? new Date(currentStatus.lastSyncedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Never";
        connStateEl.textContent =
          state === "live"
            ? `Live SSE · Synced ${syncTime}`
            : state === "connecting"
              ? "Connecting live stream…"
              : "Disconnected";
      } else {
        localPane.hidden = true;
        setupPane.hidden = false;
        connectedPane.hidden = true;
      }

      setError(isCloud && state === "error" ? currentStatus.error : "");
    }

    function renderConflicts(libraryKey, conflicts) {
      const signature = JSON.stringify([libraryKey, conflicts]);
      if (signature === conflictSignature) return;
      conflictSignature = signature;
      conflictsEl.hidden = conflicts.length === 0;
      const labels = {
        add: "Moment wasn't saved",
        edit: "Note edit wasn't applied",
        delete: "Moment wasn't deleted",
      };
      const reasons = {
        changed: "This moment has a newer version.",
        deleted: "This moment was removed.",
        duplicate: "This timestamp is already saved. You can edit the existing moment.",
        limit: "This video is at the moment limit. Free a slot before retrying.",
      };

      const fragment = document.createDocumentFragment();
      for (const { id, kind, reason, moment } of conflicts) {
        const title = moment?.title || "Saved moment";
        const timestamp = Number.isFinite(moment?.timestamp) ? ` · ${schema.formatTime(moment.timestamp)}` : "";
        const item = el("li", { className: "cloud-conflicts__item" }, [
          el("strong", { textContent: `${title}${timestamp}` }),
          el("p", { textContent: `${labels[kind] || "Change wasn't applied"}. ${reasons[reason] || ""}` }),
        ]);
        const actions = el("div", { className: "cloud-pop__actions" });
        if (typeof moment?.note === "string" && moment.note) {
          item.append(el("p", { className: "cloud-conflicts__note", textContent: moment.note }));
          const copy = el("button", { className: "btn-sm", type: "button", textContent: "Copy Note" });
          copy.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(moment.note);
              copy.textContent = "Copied";
              setTimeout(() => { copy.textContent = "Copy Note"; }, 1200);
            } catch {
              window.prompt("Copy this note:", moment.note);
            }
          });
          actions.append(copy);
        }
        if ((kind === "add" && reason === "limit") || (kind === "edit" && reason !== "deleted")) {
          const edit = kind === "edit";
          actions.append(conflictButton(edit ? "Apply My Note" : "Retry Save", () => {
            if (edit && !window.confirm("Replace the current note with your conflicting note?")) return;
            resolveConflict(id, libraryKey, "retry");
          }));
        }
        actions.append(conflictButton("Dismiss", () => resolveConflict(id, libraryKey)));
        item.append(actions);
        fragment.append(item);
      }
      conflictList.replaceChildren(fragment);
    }

    function conflictButton(textContent, onClick) {
      const button = el("button", { className: "btn-sm", type: "button", textContent });
      button.dataset.mutates = "";
      button.addEventListener("click", onClick);
      return button;
    }

    function resolveConflict(id, libraryKey, resolution) {
      if (libraryKey !== currentStatus.libraryKey) return;
      const payload = { id, libraryKey };
      if (resolution) payload.resolution = resolution;
      runOperation(() => requestStatus(ACTIONS.RESOLVE_SYNC_CONFLICT, payload));
    }

    async function requestStatus(action, payload) {
      const sequence = ++statusSequence;
      const status = await messages.sendAction(action, payload);
      if (sequence === statusSequence) applyStatus(status);
      return status;
    }

    async function refreshStatus() {
      const request = requestStatus(ACTIONS.GET_SYNC_STATUS);
      const sequence = statusSequence;
      try {
        await request;
      } catch (err) {
        if (sequence === statusSequence) setError(err.message);
      }
    }

    async function runOperation(work) {
      if (busy || !currentStatus.libraryKey) return;
      busy = true;
      setError("");
      syncMsgEl.hidden = true;
      updateButtons();
      try {
        await work();
      } catch (err) {
        setError(err.message || "Cloud operation failed. Please try again.");
      } finally {
        busy = false;
        updateButtons();
      }
    }

    function showFeedback(status, text) {
      if (status.libraryKey !== currentStatus.libraryKey || currentStatus.state === "error") return;
      syncMsgEl.textContent = text;
      syncMsgEl.hidden = false;
    }

    function positionPopover() {
      const rect = cloudBtn.getBoundingClientRect();
      const width = Math.min(350, window.innerWidth - 24);
      const left = Math.min(
        Math.max(12, rect.right + window.scrollX - width),
        window.scrollX + window.innerWidth - width - 12,
      );
      pop.style.left = `${left}px`;
      pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
    }

    function setPopoverOpen(open) {
      pop.hidden = !open;
      cloudBtn.setAttribute("aria-expanded", String(open));
      if (open) positionPopover();
    }

    function togglePopover() {
      const opening = pop.hidden;
      setPopoverOpen(opening);
      if (opening && !busy) refreshStatus();
    }

    async function requestCloudPermissions() {
      if (!ext || !ext.permissions || !ext.permissions.request) return true;
      const granted = await ext.permissions.request({ origins: CLOUD_ORIGINS });
      if (!granted) {
        throw new Error("Network permission is required for Firebase Cloud Sync.");
      }
      return true;
    }

    function handleSignIn() {
      updateParsedPreview();
      const databaseURL = parsedConfig.databaseURL || dbUrlEl.value.trim();

      if (!parsedConfig.apiKey || !databaseURL) {
        setError("Paste your full Firebase config snippet (with apiKey and databaseURL).");
        return;
      }

      const credentials = { apiKey: parsedConfig.apiKey, databaseURL, email: emailEl.value, password: passEl.value };
      runOperation(async () => {
        await requestCloudPermissions();
        await requestStatus(ACTIONS.CLOUD_SIGN_IN, credentials);
        passEl.value = "";
      });
    }

    cloudBtn.addEventListener("click", togglePopover);
    snippetEl.addEventListener("input", updateParsedPreview);
    dbUrlEl.addEventListener("input", updateParsedPreview);

    modeLocalBtn.addEventListener("click", () => {
      runOperation(() => requestStatus(ACTIONS.CLOUD_SET_MODE, { mode: "local" }));
    });

    modeCloudBtn.addEventListener("click", () => {
      runOperation(async () => {
        if (currentStatus.hasCredentials) await requestCloudPermissions();
        await requestStatus(ACTIONS.CLOUD_SET_MODE, { mode: "cloud" });
      });
    });

    signInBtn.addEventListener("click", handleSignIn);

    if (guideBtn) {
      guideBtn.addEventListener("click", () => {
        const url = ext && ext.runtime && ext.runtime.getURL
          ? ext.runtime.getURL("src/moments/firebase-guide.html")
          : "firebase-guide.html";
        window.open(url, "_blank", "noopener,noreferrer");
      });
    }

    syncNowBtn.addEventListener("click", () => {
      runOperation(async () => {
        const status = await requestStatus(ACTIONS.CLOUD_SYNC_NOW);
        if (!status?.syncResult) return;
        const { pushedCount, pulledCount } = status.syncResult;
        showFeedback(status, status.pendingCount > 0
          ? "Some changes are still waiting to sync."
          : pushedCount === 0 && pulledCount === 0
            ? "No changes synced."
            : `Synced (pushed ${pushedCount}, pulled ${pulledCount}).`);
      });
    });

    importLocalBtn.addEventListener("click", () => {
      const { mode, hasCredentials, libraryKey, email } = currentStatus;
      if (mode !== "cloud" || !hasCredentials || !libraryKey) return;
      if (!window.confirm(`Copy this device's local moments into ${email || "the current cloud account"}? Your local library will stay unchanged.`)) return;
      runOperation(async () => {
        const status = await requestStatus(ACTIONS.CLOUD_IMPORT_LOCAL, { libraryKey });
        if (!status || status.libraryKey !== libraryKey) return;
        const result = status.importResult;
        if (!result) {
          showFeedback(status, "Local library copy complete.");
          return;
        }
        const summary = [`Copied ${result.added}`];
        if (result.duplicates) summary.push(`${result.duplicates} already saved`);
        if (result.limitSkipped) summary.push(`${result.limitSkipped} over the per-video limit`);
        if (result.invalid) summary.push(`${result.invalid} invalid`);
        showFeedback(status, summary.join(" · "));
      });
    });

    function signOut() {
      runOperation(() => requestStatus(ACTIONS.CLOUD_SIGN_OUT));
    }
    signOutBtn.addEventListener("click", signOut);
    pausedSignOutBtn.addEventListener("click", signOut);

    document.addEventListener("mousedown", (e) => {
      if (pop.hidden) return;
      if (pop.contains(e.target) || cloudBtn.contains(e.target)) return;
      setPopoverOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !pop.hidden) {
        const returnFocus = pop.contains(document.activeElement);
        setPopoverOpen(false);
        if (returnFocus) cloudBtn.focus();
      }
    });

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const status = changes.syncStatus?.newValue;
      if (changes.syncStatus) {
        ++statusSequence;
        applyStatus(status);
        if (!status) {
          refreshStatus();
          return;
        }
      }
      // The storage broadcast may omit conflict notes and only change the revision.
      const revision = changes.momentsRevision;
      const revisionChanged = revision && revision.oldValue !== revision.newValue;
      if ((changes.syncStatus || revisionChanged) && currentStatus.conflictCount > 0 && !Array.isArray(status?.conflicts)) {
        refreshStatus();
      }
    });

    updateButtons();
    refreshStatus();
  }

  YTM.cloudUi = { initCloudUi };
})();
