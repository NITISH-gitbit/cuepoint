var YTM = YTM || {};

(function () {
  "use strict";

  const BTN_ID = "ytm-save-btn";
  const LOG = "[YT Moments]";
  const POLL_INTERVAL_MS = 500;
  const MAX_POLL_ATTEMPTS = 40;

  const { schema, messages, contentDom: dom, popover } = YTM;
  const { ACTIONS } = messages;

  let pollTimer = null;
  let rafScheduled = false;
  let saving = false;

  function makeButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "ytm-save-btn";
    btn.setAttribute("aria-label", "Save this moment");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path fill="#FF4E45" d="M8 5v14l11-7z"/></svg>' +
      '<span class="ytm-save-btn__label">Save moment</span>';
    btn.addEventListener("click", handleSaveClick);
    return btn;
  }

  function ensureButton() {
    if (!dom.onWatchPage()) return false;

    const existing = document.getElementById(BTN_ID);
    if (existing && document.contains(existing)) return true;

    const row = dom.findActionRow();
    if (row) {
      row.appendChild(makeButton());
      return true;
    }
    return false;
  }

  function injectFallback() {
    if (!dom.onWatchPage() || document.getElementById(BTN_ID)) return;
    const mount = dom.findFallbackMount();
    if (!mount) {
      console.warn(LOG, "no mount point found — YouTube layout may have changed");
      return;
    }
    const wrap = document.createElement("div");
    wrap.style.margin = "8px 0 0";
    wrap.appendChild(makeButton());
    mount.prepend(wrap);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    if (!dom.onWatchPage()) return;
    if (ensureButton()) return;

    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts++;
      if (!dom.onWatchPage()) {
        stopPolling();
        return;
      }
      if (ensureButton()) {
        stopPolling();
        return;
      }
      if (attempts >= MAX_POLL_ATTEMPTS) {
        stopPolling();
        injectFallback();
      }
    }, POLL_INTERVAL_MS);
  }

  function scheduleEnsure() {
    if (rafScheduled || !dom.onWatchPage()) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      ensureButton();
    });
  }

  function flashButton(btn, text, cssClass) {
    const label = btn.querySelector(".ytm-save-btn__label");
    const original = label ? label.textContent : null;
    btn.classList.add(cssClass);
    if (label) label.textContent = text;
    setTimeout(() => {
      btn.classList.remove(cssClass);
      if (label && original !== null) label.textContent = original;
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
      const note = await popover.openNotePopover({
        anchorEl: btn,
        timeLabel: schema.formatTime(timestamp),
      });
      if (note === null) return;

      await messages.sendAction(ACTIONS.ADD_MOMENT, {
        libraryKey,
        videoId,
        timestamp,
        title,
        channelName: channel.name,
        channelUrl: channel.url,
        note,
      });

      flashButton(btn, "Saved", "ytm-save-btn--done");
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
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", () => {
    popover.closePopover();
    startPolling();
  });

  startPolling();
})();
