var YTM = YTM || {};

(function () {
  "use strict";

  const BTN_ID = "ytm-save-btn";
  const DEFAULT_BTN_LABEL = "Save moment";
  const FLASH_CLASSES = ["ytm-save-btn--done", "ytm-save-btn--err"];
  const LOG = "[CuePoint]";
  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_ATTEMPTS = 40;

  const { schema, messages, contentDom: dom, popover } = YTM;
  const { ACTIONS } = messages;

  let pollTimer = null;
  let flashTimer = null;
  let rafScheduled = false;
  let saving = false;
  let saveButton = null;
  let fallbackWrap = null;
  let lastRoute = currentRoute();

  function currentRoute() {
    return location.pathname + location.search;
  }

  function makeButton() {
    const NS = "http://www.w3.org/2000/svg";
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "ytm-save-btn";
    btn.setAttribute("aria-label", "Save this moment");

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("fill", "#FF4E45");
    path.setAttribute("d", "M8 5v14l11-7z");
    svg.appendChild(path);

    const label = document.createElement("span");
    label.className = "ytm-save-btn__label";
    label.textContent = DEFAULT_BTN_LABEL;

    btn.append(svg, label);
    btn.addEventListener("click", handleSaveClick);
    return btn;
  }

  function ensureButton() {
    const placement = dom.onWatchPage() ? dom.findButtonPlacement() : null;
    if (!placement?.row && !placement?.fallback) {
      saveButton?.remove();
      fallbackWrap?.remove();
      return false;
    }

    saveButton ||= makeButton();
    saveButton.classList.toggle("ytm-save-btn--mobile", !!placement.mobile);
    if (placement.row) {
      if (saveButton.parentElement !== placement.row) placement.row.appendChild(saveButton);
      fallbackWrap?.remove();
    } else {
      if (!fallbackWrap) {
        fallbackWrap = document.createElement("div");
        fallbackWrap.className = "ytm-save-fallback";
      }
      fallbackWrap.classList.toggle("ytm-save-fallback--mobile", !!placement.mobile);
      if (saveButton.parentElement !== fallbackWrap) fallbackWrap.appendChild(saveButton);
      if (placement.after) {
        if (placement.fallback.nextElementSibling !== fallbackWrap) placement.fallback.after(fallbackWrap);
      } else if (fallbackWrap.parentElement !== placement.fallback) {
        placement.fallback.appendChild(fallbackWrap);
      }
    }
    return true;
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (ensureButton() || !dom.onWatchPage()) return;

    let attempts = 0;
    pollTimer = setInterval(() => {
      if (ensureButton() || !dom.onWatchPage() || ++attempts >= MAX_POLL_ATTEMPTS) stopPolling();
    }, POLL_INTERVAL_MS);
  }

  function clearFlash(btn = saveButton) {
    if (flashTimer !== null) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
    if (!btn) return;
    btn.classList.remove(...FLASH_CLASSES);
    const label = btn.querySelector(".ytm-save-btn__label");
    if (label) label.textContent = DEFAULT_BTN_LABEL;
  }

  function handleNavigation() {
    lastRoute = currentRoute();
    popover.closePopover();
    clearFlash();
    startPolling();
  }

  function scheduleEnsure() {
    const routeChanged = currentRoute() !== lastRoute;
    const hasInjected = !!(saveButton?.isConnected || fallbackWrap?.isConnected);
    if (rafScheduled || (!routeChanged && !dom.onWatchPage() && !hasInjected)) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (currentRoute() !== lastRoute) {
        handleNavigation();
        return;
      }
      ensureButton();
    });
  }

  function flashButton(btn, text, cssClass) {
    clearFlash(btn);
    const label = btn.querySelector(".ytm-save-btn__label");
    btn.classList.add(cssClass);
    if (label) label.textContent = text;
    flashTimer = setTimeout(() => {
      flashTimer = null;
      clearFlash(btn);
    }, 1800);
  }

  async function handleSaveClick(e) {
    if (saving) return;
    const btn = e.currentTarget;
    const video = dom.getVideoEl();
    if (!video || !dom.onWatchPage()) return;

    const timestamp = Math.floor(video.currentTime || 0);
    const videoId = dom.getVideoId();
    if (!videoId) return;

    const title = dom.getTitle();
    const channel = dom.getChannel();

    saving = true;
    try {
      const { libraryKey } = await messages.sendAction(ACTIONS.GET_ACTIVE_LIBRARY);
      if (!btn.isConnected || !dom.onWatchPage() || dom.getVideoId() !== videoId) return;
      const note = await popover.openNotePopover({
        anchorEl: btn,
        timeLabel: schema.formatTime(timestamp),
      });
      if (note === null || !dom.onWatchPage() || dom.getVideoId() !== videoId) return;

      const result = await messages.sendAction(ACTIONS.ADD_MOMENT, {
        libraryKey,
        videoId,
        timestamp,
        title,
        channelName: channel.name,
        channelUrl: channel.url,
        note,
      });

      if (result.alreadySaved) {
        flashButton(btn, "Already saved", "ytm-save-btn--done");
        popover.showNotice({
          anchorEl: btn,
          message: "This timestamp is already saved. Open CuePoint and choose Edit on the saved timestamp to change its note.",
        });
      } else {
        flashButton(btn, "Saved", "ytm-save-btn--done");
      }
    } catch (err) {
      console.error(LOG, "failed to save", err);
      const msg = (err && err.message) || "";
      if (/maximum of \d+ saved moments/i.test(msg)) {
        flashButton(btn, `Max ${schema.MAX_MOMENTS_PER_VIDEO}/video`, "ytm-save-btn--err");
        popover.showNotice({
          anchorEl: btn,
          message: `This video already has ${schema.MAX_MOMENTS_PER_VIDEO} saved moments. Delete one in Moments to save another.`,
          isError: true,
        });
      } else if (/context invalidated|unavailable|receiving end does not exist/i.test(msg)) {
        flashButton(btn, "Reload tab", "ytm-save-btn--err");
        popover.showNotice({
          anchorEl: btn,
          message: "Extension was updated — please reload this YouTube tab.",
          isError: true,
        });
      } else {
        flashButton(btn, "Error", "ytm-save-btn--err");
        popover.showNotice({
          anchorEl: btn,
          message: msg || "Couldn't save this moment. Please try again.",
          isError: true,
        });
      }
    } finally {
      saving = false;
    }
  }

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributeFilter: ["hidden", "video-id", "data-video-id"],
  });

  window.addEventListener("resize", scheduleEnsure);
  for (const evt of ["yt-navigate-finish", "state-navigateend", "popstate"]) {
    window.addEventListener(evt, handleNavigation);
  }

  startPolling();
})();
