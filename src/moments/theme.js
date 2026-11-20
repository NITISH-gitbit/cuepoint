var YTM = YTM || {};

(function () {
  "use strict";

  const STORAGE_KEY = "cuepoint:theme";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function systemTheme() {
    try {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
    } catch {
      // Ignore matchMedia errors in restricted contexts.
    }
    return "dark";
  }

  function readStoredTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function writeStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable; in-memory document attribute still applies.
    }
  }

  function getTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return readStoredTheme() || systemTheme();
  }

  function applyTheme(theme) {
    const resolved = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", resolved);
    return resolved;
  }

  function buildThemeIcon(targetTheme) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "theme-toggle__icon");

    if (targetTheme === "light") {
      // Sun icon when currently dark (clicking switches to light)
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "4");
      svg.appendChild(circle);

      const rays = [
        [12, 2, 12, 4],
        [12, 20, 12, 22],
        [4.93, 4.93, 6.34, 6.34],
        [17.66, 17.66, 19.07, 19.07],
        [2, 12, 4, 12],
        [20, 12, 22, 12],
        [6.34, 17.66, 4.93, 19.07],
        [19.07, 4.93, 17.66, 6.34],
      ];
      for (const [x1, y1, x2, y2] of rays) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        svg.appendChild(line);
      }
    } else {
      // Crescent moon icon when currently light (clicking switches to dark)
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z");
      svg.appendChild(path);
    }
    return svg;
  }

  function syncToggleButtons(theme) {
    const nextTheme = theme === "light" ? "dark" : "light";
    const label = nextTheme === "light" ? "Switch to light mode" : "Switch to dark mode";
    for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", String(theme === "light"));
      btn.replaceChildren(buildThemeIcon(nextTheme));
    }
  }

  function setTheme(theme, { persist = true } = {}) {
    const resolved = applyTheme(theme);
    if (persist) writeStoredTheme(resolved);
    syncToggleButtons(resolved);
    return resolved;
  }

  function toggleTheme() {
    const current = getTheme();
    return setTheme(current === "light" ? "dark" : "light", { persist: true });
  }

  function bindToggles() {
    const current = applyTheme(getTheme());
    syncToggleButtons(current);

    for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
      if (btn.dataset.themeBound) continue;
      btn.dataset.themeBound = "1";
      btn.addEventListener("click", toggleTheme);
    }
  }

  // Apply before first paint to avoid theme flash.
  applyTheme(readStoredTheme() || systemTheme());

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindToggles, { once: true });
    } else {
      bindToggles();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue === "light" || event.newValue === "dark" ? event.newValue : systemTheme();
      applyTheme(next);
      syncToggleButtons(next);
    });

    try {
      if (typeof window.matchMedia === "function") {
        const media = window.matchMedia("(prefers-color-scheme: light)");
        media.addEventListener("change", () => {
          if (readStoredTheme()) return;
          const next = media.matches ? "light" : "dark";
          applyTheme(next);
          syncToggleButtons(next);
        });
      }
    } catch {
      // Ignore listener errors in headless contexts.
    }
  }

  const api = { STORAGE_KEY, getTheme, setTheme, toggleTheme, bindToggles };
  YTM.theme = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
