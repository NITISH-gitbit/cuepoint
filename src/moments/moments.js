var YTM = YTM || {};

(function () {
  "use strict";

  const { schema, messages, momentsState, momentsRender } = YTM;
  const { ACTIONS } = messages;
  const ext = messages.getExtApi();

  const listEl = document.getElementById("list");
  const pagerEl = document.getElementById("pager");
  const emptyEl = document.getElementById("empty");
  const countEl = document.getElementById("count");
  const searchEl = document.getElementById("search");
  const exportEl = document.getElementById("export");
  const randomEl = document.getElementById("random");
  const importEl = document.getElementById("import");
  const importFileEl = document.getElementById("importFile");
  const statusEl = document.getElementById("status");
  const pageSizeEl = document.getElementById("pageSize");

  const popoverEl = momentsRender.el("div", {
    id: "tsPopover",
    className: "ts-pop",
    hidden: true,
  });
  popoverEl.setAttribute("role", "dialog");
  popoverEl.setAttribute("aria-label", "Timestamp note");
  document.body.appendChild(popoverEl);

  let pageSize = 10;
  let allMoments = [];
  let query = "";
  let currentPage = 1;
  let activeMomentId = null;
  let pinnedMomentId = null;
  let editingId = null;
  let editingBaseMoment = null;
  let closeTimer = null;
  let searchTimer = null;
  let statusTimer = null;
  const loadErrorMessage = "Failed to load saved moments.";
  let libraryKey = null;
  let libraryEpoch = 0;
  let fetchSequence = 0;
  let libraryLoaded = false;
  let canSaveConflicts = false;
  let loadFailed = false;
  let savingEditor = null;
  const drafts = new Map();

  function storeDraft(id, note) {
    if (!libraryKey) return;
    let libraryDrafts = drafts.get(libraryKey);
    if (note === undefined) {
      libraryDrafts?.delete(id);
      if (libraryDrafts?.size === 0) drafts.delete(libraryKey);
    } else {
      if (!libraryDrafts) drafts.set(libraryKey, (libraryDrafts = new Map()));
      libraryDrafts.set(id, { text: note, baseMoment: editingBaseMoment });
    }
  }

  function rememberDraft() {
    const editor = popoverEl.querySelector("textarea[data-editor]");
    if (editor) {
      storeDraft(editor.dataset.editor, editor.value === editor.defaultValue ? undefined : editor.value);
    }
  }

  function showStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " status--" + kind : "");
    statusEl.hidden = false;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.hidden = true;
    }, 6000);
  }

  function showEmpty(title, body) {
    emptyEl.hidden = false;
    emptyEl.replaceChildren(
      momentsRender.el("h2", { textContent: title }),
      body,
    );
  }

  function clearCloseTimer() {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function syncActivePillClasses() {
    for (const pill of listEl.querySelectorAll(".ts-pill")) {
      const isActive = pill.dataset.momentId === activeMomentId;
      pill.classList.toggle("ts-pill--active", isActive);
      pill.setAttribute("aria-expanded", isActive ? "true" : "false");
    }
  }

  function positionPopover(pill) {
    const rect = pill.getBoundingClientRect();
    const popWidth = Math.min(300, Math.max(0, window.innerWidth - 24));
    const left = Math.min(
      Math.max(window.scrollX + 12, rect.left + window.scrollX),
      window.scrollX + window.innerWidth - popWidth - 12,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    popoverEl.hidden = false;
    popoverEl.style.left = `${left}px`;

    if (spaceBelow >= 170 || rect.top < 170) {
      popoverEl.style.top = `${rect.bottom + window.scrollY + 8}px`;
      popoverEl.dataset.placement = "bottom";
    } else {
      const popHeight = popoverEl.offsetHeight || 130;
      popoverEl.style.top = `${rect.top + window.scrollY - popHeight - 8}px`;
      popoverEl.dataset.placement = "top";
    }
  }

  function openPopoverFor(momentId, { pin = false } = {}) {
    clearCloseTimer();
    const m = allMoments.find((x) => x.id === momentId);
    const pill = listEl.querySelector(`.ts-pill[data-moment-id="${CSS.escape(momentId)}"]`);
    if (!m || !pill) return;

    activeMomentId = momentId;
    if (pin) pinnedMomentId = momentId;
    syncActivePillClasses();

    const draft = drafts.get(libraryKey)?.get(momentId)?.text;
    popoverEl.replaceChildren(momentsRender.renderPopoverContent(m, { editingId, draft }));
    positionPopover(pill);
  }

  function closePopover({ keepDraft = true } = {}) {
    if (keepDraft) rememberDraft();
    clearCloseTimer();
    activeMomentId = null;
    pinnedMomentId = null;
    editingId = null;
    popoverEl.hidden = true;
    popoverEl.innerHTML = "";
    syncActivePillClasses();
  }

  function scheduleClosePopover() {
    clearCloseTimer();
    if (pinnedMomentId || editingId) return;
    closeTimer = setTimeout(() => {
      if (!pinnedMomentId && !editingId) {
        closePopover();
      }
    }, 140);
  }

  function render() {
    exportEl.disabled = importEl.disabled = !libraryLoaded;
    if (mobileExportBtn) mobileExportBtn.disabled = !libraryLoaded;
    if (mobileImportBtn) mobileImportBtn.disabled = !libraryLoaded;
    if (!libraryLoaded) {
      countEl.textContent = loadFailed ? "Library unavailable" : "Loading moments…";
      listEl.replaceChildren();
      pagerEl.hidden = true;
      emptyEl.hidden = true;
      randomEl.disabled = true;
      if (mobileRandomBtn) mobileRandomBtn.disabled = true;
      return;
    }

    const items = momentsState.filterAndSort(allMoments, query);
    const groups = momentsState.groupByVideo(items);
    if (editingId) {
      // Keep the textarea mounted across live updates (selection, undo and IME included).
      // If the moment disappears, keep the draft available without restoring the moment.
      const exists = allMoments.some((m) => m.id === editingId);
      const canSaveAsConflict = canSaveConflicts && !!editingBaseMoment?.version;
      const saveButton = popoverEl.querySelector('[data-action="save"]');
      const editorStatus = popoverEl.querySelector(".ts-pop__editor-status");
      if (saveButton) saveButton.disabled = !exists && !canSaveAsConflict;
      if (editorStatus) {
        editorStatus.hidden = exists;
        if (!exists) {
          const text = canSaveAsConflict
            ? "This moment was removed. Save to keep your draft in Sync conflicts, or copy your text here."
            : "This moment was removed. You can still copy your draft before closing.";
          if (editorStatus.textContent !== text) editorStatus.textContent = text;
        }
      }
      const groupIndex = groups.findIndex((g) => g.moments.some((m) => m.id === editingId));
      if (groupIndex !== -1) currentPage = Math.floor(groupIndex / pageSize) + 1;
    }
    const totalMoments = allMoments.length;
    const totalVideos = momentsState.groupByVideo(allMoments).length;

    countEl.textContent =
      totalMoments === 0
        ? "No moments yet"
        : `${totalMoments} saved · ${totalVideos} video${totalVideos === 1 ? "" : "s"}`;
    randomEl.disabled = totalMoments === 0;
    if (mobileRandomBtn) mobileRandomBtn.disabled = totalMoments === 0;
    listEl.innerHTML = "";

    if (totalMoments === 0) {
      if (!editingId) closePopover();
      pagerEl.hidden = true;
      showEmpty(
        "No moments yet",
        momentsRender.el("p", {}, [
          "Open a YouTube video in Firefox and choose ",
          momentsRender.el("code", { textContent: "Save moment" }),
          " below the player. Add a note if you like, then choose ",
          momentsRender.el("code", { textContent: "Save" }),
          ". Open CuePoint from Firefox’s Extensions menu or toolbar to find it again.",
        ]),
      );
      return;
    }

    if (groups.length === 0) {
      if (!editingId) closePopover();
      pagerEl.hidden = true;
      showEmpty(
        "No matches",
        momentsRender.el("p", {
          textContent: "Nothing matches your search. Try different words.",
        }),
      );
      return;
    }

    emptyEl.hidden = true;

    const paged = momentsState.paginate(groups, currentPage, pageSize);
    currentPage = paged.currentPage;

    const frag = document.createDocumentFragment();
    for (const g of paged.pageItems) {
      frag.appendChild(momentsRender.renderVideoCard(g, { activeId: activeMomentId }));
    }
    listEl.appendChild(frag);

    momentsRender.renderPager(pagerEl, currentPage, paged.totalPages, goTo);

    if (activeMomentId) {
      const stillVisible = listEl.querySelector(
        `.ts-pill[data-moment-id="${CSS.escape(activeMomentId)}"]`,
      );
      if (stillVisible) {
        if (editingId) positionPopover(stillVisible);
        else openPopoverFor(activeMomentId, { pin: !!pinnedMomentId });
      } else if (!editingId) {
        closePopover();
      }
    }
  }

  function goTo(page) {
    closePopover();
    currentPage = page;
    render();
    window.scrollTo({ top: 0 });
  }

  function shareMessage(m) {
    return `Found this moment worth sharing. Click the link and it'll jump right to that spot in the video.\n${m.url}`;
  }

  async function copyWithFeedback(btn, text, fallbackPrompt) {
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      setTimeout(() => {
        btn.classList.remove("copied");
      }, 1200);
    } catch (err) {
      console.error("Copy failed", err);
      window.prompt(fallbackPrompt, text);
    }
  }

  function finishEdit(id) {
    storeDraft(id, undefined);
    editingId = null;
    const pill = listEl.querySelector(`.ts-pill[data-moment-id="${CSS.escape(id)}"]`);
    if (pill) openPopoverFor(id, { pin: true });
    else closePopover({ keepDraft: false });
  }

  async function saveEdit(id) {
    const ta = popoverEl.querySelector(`textarea[data-editor="${CSS.escape(id)}"]`);
    if (!libraryKey || !ta || savingEditor === ta) return;
    const baseMoment = editingBaseMoment;
    if (!allMoments.some((m) => m.id === id) && !(canSaveConflicts && baseMoment?.version)) return;
    const targetLibrary = libraryKey;
    const epoch = libraryEpoch;
    const draft = ta.value;
    savingEditor = ta;
    try {
      const result = await messages.sendAction(ACTIONS.UPDATE_MOMENT, {
        id, note: draft.trim(), baseVersion: baseMoment?.version, baseMoment, libraryKey: targetLibrary,
      });
      if (epoch !== libraryEpoch) return;
      if (result?.pendingConflict) {
        showStatus("This moment changed. Your note is saved for review in Cloud Sync.", "err");
      }
      await refreshMoments();
      if (epoch === libraryEpoch && popoverEl.contains(ta)) {
        if (ta.value === draft) finishEdit(id);
        else if (result?.version) editingBaseMoment = result;
      }
    } catch (err) {
      console.error("Save failed", err);
      if (epoch === libraryEpoch) showStatus(err.message || "Couldn't save your edit. Please try again.", "err");
    } finally {
      if (savingEditor === ta) savingEditor = null;
    }
  }

  async function refreshMoments() {
    if (!libraryKey) return;
    const sequence = ++fetchSequence;
    const epoch = libraryEpoch;
    try {
      const moments = await messages.sendAction(ACTIONS.GET_MOMENTS, { libraryKey });
      if (sequence !== fetchSequence || epoch !== libraryEpoch) return;
      allMoments = Array.isArray(moments) ? moments : [];
      libraryLoaded = true;
      if (loadFailed && statusEl.textContent === loadErrorMessage) statusEl.hidden = true;
      loadFailed = false;
      render();
    } catch (err) {
      if (sequence !== fetchSequence || epoch !== libraryEpoch) return;
      console.error("Failed to load saved moments", err);
      loadFailed = true;
      render();
      showStatus(loadErrorMessage, "err");
    }
  }

  function switchLibrary(nextLibrary, cloudLibrary) {
    canSaveConflicts = cloudLibrary;
    if (nextLibrary === libraryKey) return;
    closePopover();
    libraryKey = nextLibrary;
    libraryEpoch++;
    allMoments = [];
    libraryLoaded = false;
    loadFailed = false;
    currentPage = 1;
    statusEl.hidden = true;
    render();
    refreshMoments();
  }

  async function loadPageSize() {
    const { pageSize: savedPageSize = 10 } = await ext.storage.local.get("pageSize");
    pageSize = momentsState.parsePageSize(savedPageSize);
    pageSizeEl.value = savedPageSize === "all" ? "all" : String(savedPageSize);
    render();
  }

  // ---------- Hover, Focus & Click for Timestamp Pills ----------
  listEl.addEventListener("pointerover", (e) => {
    const pill = e.target.closest(".ts-pill");
    if (!pill || pinnedMomentId || editingId) return;
    openPopoverFor(pill.dataset.momentId, { pin: false });
  });

  listEl.addEventListener("pointerout", (e) => {
    const pill = e.target.closest(".ts-pill");
    if (!pill) return;
    if (e.relatedTarget && (pill.contains(e.relatedTarget) || popoverEl.contains(e.relatedTarget))) {
      return;
    }
    scheduleClosePopover();
  });

  listEl.addEventListener("focusin", (e) => {
    const pill = e.target.closest(".ts-pill");
    if (!pill || pinnedMomentId || editingId) return;
    openPopoverFor(pill.dataset.momentId, { pin: false });
  });

  listEl.addEventListener("click", (e) => {
    const pill = e.target.closest(".ts-pill");
    if (!pill) return;
    const id = pill.dataset.momentId;
    if (pinnedMomentId === id && !editingId) {
      closePopover();
    } else {
      rememberDraft();
      editingId = null;
      openPopoverFor(id, { pin: true });
    }
  });

  popoverEl.addEventListener("pointerenter", () => clearCloseTimer());
  popoverEl.addEventListener("pointerleave", () => scheduleClosePopover());

  popoverEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    const m = allMoments.find((x) => x.id === id);

    if (action === "edit" && m) {
      const resumed = drafts.get(libraryKey)?.get(id);
      editingBaseMoment = resumed?.baseMoment || m;
      editingId = id;
      pinnedMomentId = id;
      openPopoverFor(id, { pin: true });
    } else if (action === "cancel") {
      finishEdit(id);
    } else if (action === "save") {
      await saveEdit(id);
    } else if (action === "copy" && m) {
      await copyWithFeedback(btn, m.url, "Copy this link:");
    } else if (action === "share" && m) {
      await copyWithFeedback(btn, shareMessage(m), "Copy this message:");
    } else if (action === "delete" && m && libraryKey) {
      const targetLibrary = libraryKey;
      const epoch = libraryEpoch;
      const label = m.note || m.title;
      if (!window.confirm(`Delete ${label ? `“${label}”` : "this moment"}?`)) return;
      try {
        await messages.sendAction(ACTIONS.DELETE_MOMENT, {
          id, baseVersion: m.version, libraryKey: targetLibrary,
        });
        if (epoch !== libraryEpoch) return;
        if (activeMomentId === id && !editingId) closePopover();
        await refreshMoments();
      } catch (err) {
        console.error("Delete failed", err);
        if (epoch === libraryEpoch) {
          showStatus(err.message || "Couldn't delete this moment. Please try again.", "err");
          await refreshMoments();
        }
      }
    }
  });

  popoverEl.addEventListener("keydown", (e) => {
    const ta = e.target.closest("textarea[data-editor]");
    if (!ta) return;
    const id = ta.dataset.editor;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finishEdit(id);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit(id);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (popoverEl.hidden) return;
    if (popoverEl.contains(e.target)) return;
    if (e.target.closest(".ts-pill")) return;
    closePopover();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popoverEl.hidden && !editingId) {
      closePopover();
    }
  });

  searchEl.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = searchEl.value;
      currentPage = 1;
      closePopover();
      render();
    }, 120);
  });

  pageSizeEl.addEventListener("change", async () => {
    const raw = pageSizeEl.value;
    pageSize = momentsState.parsePageSize(raw);
    currentPage = 1;
    closePopover();
    await ext.storage.local.set({ pageSize: raw === "all" ? "all" : Number(raw) });
    render();
  });

  randomEl.addEventListener("click", () => {
    if (allMoments.length === 0) return;
    const m = allMoments[Math.floor(Math.random() * allMoments.length)];
    const safeUrl = schema.sanitizeUrl(m.url, { requireYouTubeHost: true });
    if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
  });

  exportEl.addEventListener("click", () => {
    const data = JSON.stringify(allMoments, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cuepoint-moments-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  let importTarget = null;
  importEl.addEventListener("click", () => {
    if (!libraryKey || !libraryLoaded) return;
    importTarget = { libraryKey, epoch: libraryEpoch };
    importFileEl.click();
  });

  importFileEl.addEventListener("change", async () => {
    const target = importTarget;
    importTarget = null;
    const file = importFileEl.files && importFileEl.files[0];
    importFileEl.value = "";
    if (!file || !target || target.epoch !== libraryEpoch) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      if (target.epoch === libraryEpoch) showStatus("Couldn't read that file — is it valid JSON?", "err");
      return;
    }
    if (target.epoch !== libraryEpoch) return;
    if (!Array.isArray(parsed)) {
      showStatus("That file isn't a Moments export (expected a list).", "err");
      return;
    }
    if (parsed.length === 0) {
      showStatus("No moments found in that file.", "err");
      return;
    }

    try {
      const { added, duplicates, invalid, limitSkipped } = await messages.sendAction(
        ACTIONS.IMPORT_MOMENTS,
        { items: parsed, libraryKey: target.libraryKey },
      );
      if (target.epoch !== libraryEpoch) return;

      if (added > 0) {
        if (!editingId) currentPage = 1;
        await refreshMoments();
        if (target.epoch !== libraryEpoch) return;
      }

      const parts = [`Imported ${added}`];
      if (duplicates)
        parts.push(`${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped`);
      if (limitSkipped)
        parts.push(`${limitSkipped} over ${schema.MAX_MOMENTS_PER_VIDEO}/video limit skipped`);
      if (invalid) parts.push(`${invalid} invalid skipped`);
      showStatus(parts.join(" · "), added > 0 ? "ok" : "err");
    } catch (err) {
      console.error("Import failed", err);
      if (target.epoch === libraryEpoch) showStatus("Couldn't import moments. Please try again.", "err");
    }
  });

  document.getElementById("version").textContent =
    "v" + ext.runtime.getManifest().version;


  // ---------- Mobile Overflow Menu & Compact Controls ----------
  const mobileRandomBtn = document.getElementById("mobileRandomBtn");
  const moreBtn = document.getElementById("moreBtn");
  const moreMenu = document.getElementById("moreMenu");
  const moreCount = document.getElementById("moreCount");
  const mobilePageSizeEl = document.getElementById("mobilePageSize");
  const mobileImportBtn = document.getElementById("mobileImportBtn");
  const mobileExportBtn = document.getElementById("mobileExportBtn");

  function closeMoreMenu() {
    if (moreMenu) moreMenu.hidden = true;
    if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");
  }

  if (mobileRandomBtn) {
    mobileRandomBtn.addEventListener("click", () => randomEl.click());
  }
  if (mobileImportBtn) {
    mobileImportBtn.addEventListener("click", () => {
      closeMoreMenu();
      importEl.click();
    });
  }
  if (mobileExportBtn) {
    mobileExportBtn.addEventListener("click", () => {
      closeMoreMenu();
      exportEl.click();
    });
  }
  if (mobilePageSizeEl) {
    mobilePageSizeEl.addEventListener("change", () => {
      pageSizeEl.value = mobilePageSizeEl.value;
      pageSizeEl.dispatchEvent(new Event("change"));
    });
  }
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener("click", () => {
      const opening = moreMenu.hidden;
      if (opening) {
        if (moreCount) moreCount.textContent = countEl.textContent;
        if (mobilePageSizeEl) mobilePageSizeEl.value = pageSizeEl.value;
        const rect = moreBtn.getBoundingClientRect();
        const left = Math.min(
          Math.max(12, rect.right + window.scrollX - 210),
          window.scrollX + window.innerWidth - 222,
        );
        moreMenu.style.left = `${left}px`;
        moreMenu.style.top = `${rect.bottom + window.scrollY + 8}px`;
      }
      moreMenu.hidden = !opening;
      moreBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    });

    document.addEventListener("mousedown", (e) => {
      if (!moreMenu.hidden && !moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
        moreMenu.hidden = true;
        moreBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  YTM.cloudUi.initCloudUi(switchLibrary);
  ext.storage.onChanged.addListener((changes, area) => {
    const revision = changes.momentsRevision;
    if (area === "local" && revision && revision.oldValue !== revision.newValue) refreshMoments();
  });

  render();
  loadPageSize().catch((err) => console.error("Failed to load page size", err));
})();
