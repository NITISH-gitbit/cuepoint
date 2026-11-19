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

  function positionBox(box, anchorEl) {
    if (document.fullscreenElement || !anchorEl || !anchorEl.getBoundingClientRect) {
      box.classList.add("ytm-popover--fixed");
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      box.classList.add("ytm-popover--fixed");
      return;
    }

    const boxWidth = 300;
    const boxHeight = box.offsetHeight || 132;
    const left = Math.min(
      Math.max(12, rect.left),
      window.innerWidth - boxWidth - 12,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= boxHeight + 16 || rect.top < boxHeight + 16
        ? rect.bottom + 8
        : rect.top - boxHeight - 8;

    box.style.position = "fixed";
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(12, top)}px`;
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
      box.append(header, input, actions);
      host.appendChild(box);
      positionBox(box, anchorEl);

      function finish(result, restoreFocus = true) {
        if (settled) return;
        settled = true;
        activeCleanup = null;
        document.removeEventListener("mousedown", onDocMouseDown, true);
        document.removeEventListener("keydown", onDocKeyDown, true);
        box.remove();
        if (restoreFocus && anchorEl?.isConnected) anchorEl.focus({ preventScroll: true });
        resolve(result);
      }

      activeCleanup = () => finish(null, false);

      function onDocMouseDown(e) {
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

      document.addEventListener("mousedown", onDocMouseDown, true);
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
    positionBox(box, anchorEl);

    const timer = setTimeout(() => {
      if (activeCleanup) activeCleanup(null);
    }, 3200);

    activeCleanup = () => {
      clearTimeout(timer);
      activeCleanup = null;
      box.remove();
    };
  }

  YTM.popover = {
    openNotePopover,
    showNotice,
    closePopover,
  };
})();
