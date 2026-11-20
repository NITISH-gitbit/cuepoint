var YTM = YTM || {};

(function () {
  "use strict";

  function computeActiveSectionId({
    sections,
    scrollY,
    viewportHeight,
    scrollHeight,
    trackBottom,
  }) {
    if (!sections.length) return "";
    if (scrollY <= 8) return sections[0].id;

    const baseBottom = Number.isFinite(trackBottom) && trackBottom > 0 ? trackBottom : 100;
    const readingOffset = Math.min(240, Math.max(60, Math.round((viewportHeight - baseBottom) * 0.28)));
    const readingLine = baseBottom + readingOffset;

    let current = sections[0].id;
    for (const section of sections) {
      if (section.top <= readingLine) {
        current = section.id;
      } else {
        break;
      }
    }

    const maxScroll = Math.max(0, scrollHeight - viewportHeight);
    if (maxScroll > 0 && scrollY >= maxScroll - 8) {
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].top < viewportHeight - 80) {
          return sections[i].id;
        }
      }
    }

    return current;
  }

  function initSectionTrack({
    trackSelector,
    trackWrapSelector,
    linkSelector,
    currentAttr = "step",
  }) {
    const track = document.querySelector(trackSelector);
    const trackWrap = trackWrapSelector ? document.querySelector(trackWrapSelector) : track;
    const links = Array.from(document.querySelectorAll(linkSelector));
    const entries = links
      .map((link) => {
        const href = link.getAttribute("href") || "";
        if (!href.startsWith("#")) return null;
        const id = href.slice(1);
        const section = document.getElementById(id);
        return section ? { id, link, section } : null;
      })
      .filter(Boolean);

    if (!entries.length) return null;

    let activeId = entries[0].id;
    let lockedId = null;
    let lockTimer = null;
    let rafId = null;

    function clearLock() {
      lockedId = null;
      if (lockTimer !== null) {
        clearTimeout(lockTimer);
        lockTimer = null;
      }
    }

    function revealLinkHorizontally(link) {
      if (!track || track.scrollWidth <= track.clientWidth + 1) return;
      const linkLeft = link.offsetLeft;
      const linkRight = linkLeft + link.offsetWidth;
      const viewLeft = track.scrollLeft;
      const viewRight = viewLeft + track.clientWidth;
      const gutter = 16;

      let nextLeft = null;
      if (linkLeft - gutter < viewLeft) {
        nextLeft = Math.max(0, linkLeft - gutter);
      } else if (linkRight + gutter > viewRight) {
        nextLeft = linkRight + gutter - track.clientWidth;
      }
      if (nextLeft === null) return;

      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof track.scrollTo === "function") {
        track.scrollTo({ left: nextLeft, behavior: reduceMotion ? "auto" : "smooth" });
      } else {
        track.scrollLeft = nextLeft;
      }
    }

    function applyActive(id, { reveal = true } = {}) {
      if (!id) return;
      const changed = id !== activeId;
      activeId = id;
      let activeLink = null;

      for (const entry of entries) {
        const isActive = entry.id === id;
        entry.link.classList.toggle("is-active", isActive);
        if (isActive) {
          entry.link.setAttribute("aria-current", currentAttr);
          activeLink = entry.link;
        } else {
          entry.link.removeAttribute("aria-current");
        }
      }

      if (reveal && changed && activeLink) {
        revealLinkHorizontally(activeLink);
      }
    }

    function readActiveId() {
      const wrapRect = trackWrap?.getBoundingClientRect?.();
      return computeActiveSectionId({
        sections: entries.map((entry) => ({
          id: entry.id,
          top: entry.section.getBoundingClientRect().top,
        })),
        scrollY: window.scrollY || document.documentElement?.scrollTop || 0,
        viewportHeight: window.innerHeight || document.documentElement?.clientHeight || 900,
        scrollHeight: document.documentElement?.scrollHeight || 0,
        trackBottom: wrapRect ? wrapRect.bottom : 100,
      });
    }

    function sync() {
      const computed = readActiveId();
      if (lockedId) {
        if (computed === lockedId) {
          clearLock();
          applyActive(computed, { reveal: true });
        } else {
          applyActive(lockedId, { reveal: true });
        }
        return;
      }
      applyActive(computed, { reveal: true });
    }

    function scheduleSync() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        sync();
      });
    }

    for (const entry of entries) {
      entry.link.addEventListener("click", () => {
        clearLock();
        lockedId = entry.id;
        lockTimer = setTimeout(clearLock, 900);
        applyActive(entry.id, { reveal: true });
      });
    }

    for (const evt of ["wheel", "touchstart"]) {
      window.addEventListener(evt, clearLock, { passive: true });
    }
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    window.addEventListener("hashchange", scheduleSync);
    window.addEventListener("scrollend", () => {
      clearLock();
      sync();
    });

    applyActive(readActiveId(), { reveal: false });
    return { sync };
  }

  const api = { computeActiveSectionId, initSectionTrack };
  YTM.sectionTrack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
