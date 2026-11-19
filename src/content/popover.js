var YTM = YTM || {};

(function () {
  "use strict";

  const POPOVER_ID = "ytm-popover";
  let activeCleanup = null;

  function closePopover() {
    if (activeCleanup) {
      activeCleanup(null);
    }
  }

  function trackPosition(box, anchorEl) {
    const viewport = window.visualViewport;
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    let frame = null;

    function position() {
      const width = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
      const height = viewport?.height || document.documentElement.clientHeight || window.innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const compact = coarsePointer.matches || width <= 480;
      box.classList.toggle("ytm-popover--compact", compact);
      box.style.setProperty("--ytm-view-width", `${width}px`);
      box.style.setProperty("--ytm-view-height", `${height}px`);
      box.style.setProperty("--ytm-view-left", `${left}px`);
      box.style.setProperty("--ytm-view-top", `${top}px`);
      if (compact) return;

      const boxHeight = box.getBoundingClientRect().height;
      box.style.setProperty("--ytm-box-height", `${boxHeight}px`);
      const rect = !document.fullscreenElement && anchorEl?.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        box.style.removeProperty("--ytm-anchor-left");
        box.style.removeProperty("--ytm-anchor-top");
        return;
      }

      const spaceBelow = top + height - rect.bottom;
      const spaceAbove = rect.top - top;
      const anchorTop = spaceBelow >= boxHeight + 16 || spaceAbove < boxHeight + 16
        ? rect.bottom + 8
        : rect.top - boxHeight - 8;
      box.style.setProperty("--ytm-anchor-left", `${rect.left}px`);
      box.style.setProperty("--ytm-anchor-top", `${anchorTop}px`);
    }

    function schedulePosition() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        position();
      });
    }

    position();
    // The software keyboard can resize and pan the visual viewport without resizing the page.
    viewport?.addEventListener("resize", schedulePosition);
    viewport?.addEventListener("scroll", schedulePosition);
    coarsePointer.addEventListener("change", schedulePosition);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedulePosition);
      viewport?.removeEventListener("scroll", schedulePosition);
      coarsePointer.removeEventListener("change", schedulePosition);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition);
    };
  }

  function openNotePopover({ anchorEl, timeLabel }) {
    closePopover();

    return new Promise((resolve) => {
      let settled = false;

      const host = document.fullscreenElement || document.body;
      const box = document.createElement("div");
      box.id = POPOVER_ID;
      box.className = "ytm-popover";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Save YouTube moment");

      const header = document.createElement("div");
      header.className = "ytm-popover__head";

      const title = document.createElement("span");
      title.className = "ytm-popover__title";
      title.textContent = "Save moment";

      const badge = document.createElement("span");
      badge.className = "ytm-popover__time";
      badge.textContent = timeLabel;

      header.append(title, badge);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "ytm-popover__input";
      input.placeholder = "Add a note (optional)…";
      input.maxLength = 500;
      input.setAttribute("aria-label", "Moment note");
      input.setAttribute("enterkeyhint", "done");

      const body = document.createElement("div");
      body.className = "ytm-popover__body";
      body.append(header, input);

      const actions = document.createElement("div");
      actions.className = "ytm-popover__actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ytm-popover__btn";
      cancelBtn.textContent = "Cancel";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "ytm-popover__btn ytm-popover__btn--primary";
      saveBtn.textContent = "Save";

      actions.append(cancelBtn, saveBtn);
      box.append(body, actions);
      host.appendChild(box);
      const stopTracking = trackPosition(box, anchorEl);
      const outsideEvent = "PointerEvent" in window ? "pointerdown" : "mousedown";

      function finish(result, restoreFocus = true) {
        if (settled) return;
        settled = true;
        activeCleanup = null;
        stopTracking();
        document.removeEventListener(outsideEvent, onOutsidePress, true);
        document.removeEventListener("keydown", onDocKeyDown, true);
        box.remove();
        if (restoreFocus && anchorEl?.isConnected) anchorEl.focus({ preventScroll: true });
        resolve(result);
      }

      activeCleanup = () => finish(null, false);

      function onOutsidePress(e) {
        if (!box.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) {
          finish(null, false);
        }
      }

      function onDocKeyDown(e) {
        if (e.key === "Escape" && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }

      for (const evt of ["keydown", "keyup", "keypress"]) {
        box.addEventListener(evt, (e) => {
          e.stopPropagation();
        });
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          finish(input.value.trim());
        }
      });

      saveBtn.addEventListener("click", () => finish(input.value.trim()));
      cancelBtn.addEventListener("click", () => finish(null));

      document.addEventListener(outsideEvent, onOutsidePress, true);
      document.addEventListener("keydown", onDocKeyDown, true);

      input.focus({ preventScroll: true });
    });
  }

  function showNotice({ anchorEl, message, isError = false }) {
    closePopover();
    const host = document.fullscreenElement || document.body;
    const box = document.createElement("div");
    box.id = POPOVER_ID;
    box.className = "ytm-popover ytm-popover--notice" + (isError ? " ytm-popover--err" : "");
    box.setAttribute("role", "status");
    box.textContent = message;
    host.appendChild(box);
    const stopTracking = trackPosition(box, anchorEl);

    const timer = setTimeout(() => {
      if (activeCleanup) activeCleanup(null);
    }, 3200);

    activeCleanup = () => {
      clearTimeout(timer);
      activeCleanup = null;
      stopTracking();
      box.remove();
    };
  }

  YTM.popover = {
    openNotePopover,
    showNotice,
    closePopover,
  };
})();
