var YTM = YTM || {};

(function () {
  "use strict";

  function createMobileDom({ document, getVideoId, isVideoControl, titleFromDocument }) {
    const METADATA = "ytm-slim-video-metadata-section-renderer, ytm-slim-video-metadata-renderer, ytm-watch-metadata";
    const PLAYER_CONTAINER = "#player-container-outer, #player-container-id, ytm-player";
    const PLAYER = `${PLAYER_CONTAINER}, #player, #movie_player`;
    const ACTION_ROWS = [
      "ytm-slim-video-action-bar-renderer .slim-video-action-bar-actions",
      "ytm-slim-video-action-bar-renderer #actions",
      "ytm-slim-video-action-bar-renderer",
    ];

    function getWatch() {
      const visible = Array.from(document.querySelectorAll("ytm-watch")).filter(isVideoControl);
      const id = getVideoId();
      const declaredId = (watch) => watch.getAttribute("video-id") || watch.getAttribute("data-video-id");
      return visible.find((watch) => declaredId(watch) === id) || visible.find((watch) => !declaredId(watch)) ||
        (visible.length ? null : undefined);
    }

    function getPlayer() {
      const watch = getWatch();
      // A visible watch tree can still belong to the previous playlist item.
      if (watch === null) return null;
      const candidates = watch ? Array.from(watch.querySelectorAll(PLAYER)) : [];
      for (const player of document.querySelectorAll(PLAYER_CONTAINER)) {
        if (!player.closest("ytm-watch")) candidates.push(player);
      }
      for (const player of candidates) {
        if (!isVideoControl(player)) continue;
        const video = player.querySelector("video.html5-main-video") || player.querySelector("video");
        if (video && isVideoControl(video)) return { player, video, watch };
      }
      return null;
    }

    function findButtonPlacement() {
      const context = getPlayer();
      if (!context) return null;
      const { player, watch } = context;
      if (watch) {
        for (const metadata of watch.querySelectorAll(METADATA)) {
          if (!isVideoControl(metadata)) continue;
          for (const selector of ACTION_ROWS) {
            const row = Array.from(metadata.querySelectorAll(selector)).find(isVideoControl);
            if (row) return { row, mobile: true };
          }
        }
      }

      const anchor = player.closest("#player-container-outer") || player.closest("#player-container-id") || player;
      if (!anchor.parentElement || !isVideoControl(anchor)) return null;
      return { fallback: anchor, after: true, mobile: true };
    }

    function getTitle() {
      const title = getWatch()?.querySelector(
        "ytm-slim-video-metadata-section-renderer h1, ytm-slim-video-metadata-renderer h1, ytm-watch-metadata h1, .slim-video-information-title",
      );
      return title?.textContent.trim() || titleFromDocument();
    }

    function getChannel() {
      const link = getWatch()?.querySelector(
        "ytm-slim-owner-renderer a[href*='/@'], ytm-slim-owner-renderer a[href*='/channel/'], ytm-video-owner-renderer a[href*='/@'], ytm-video-owner-renderer a[href*='/channel/']",
      );
      return link?.textContent.trim() ? { name: link.textContent.trim(), url: link.href } : { name: "", url: "" };
    }

    return { findButtonPlacement, getVideoEl: () => getPlayer()?.video || null, getTitle, getChannel };
  }

  YTM.createMobileDom = createMobileDom;
})();
