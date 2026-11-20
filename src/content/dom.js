var YTM = YTM || {};

(function () {
  "use strict";

  const ROW_SELECTORS = [
    "#actions #top-level-buttons-computed",
    "#actions-inner #top-level-buttons-computed",
    "#actions #menu",
    "#actions-inner #menu",
  ];
  const PLAYLIST = "ytd-playlist-panel-renderer, ytd-playlist-header-renderer, ytm-playlist-panel-renderer, ytm-playlist-header-renderer, ytm-playlist-panel, ytm-playlist-compact-video-renderer";

  function onWatchPage() {
    return (
      location.pathname === "/watch" &&
      new URLSearchParams(location.search).has("v")
    );
  }

  function getVideoId() {
    return new URLSearchParams(location.search).get("v") || "";
  }

  function getVideoEl() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  function titleFromDocument() {
    return document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  }

  function getVisibleMetadata() {
    return Array.from(document.querySelectorAll("ytd-watch-metadata")).filter(isVideoControl);
  }

  function getTitle() {
    for (const metadata of getVisibleMetadata()) {
      const el = metadata.querySelector("h1 yt-formatted-string, h1");
      if (el && isVideoControl(el) && el.textContent.trim()) return el.textContent.trim();
    }
    return titleFromDocument();
  }

  function getChannel() {
    for (const metadata of getVisibleMetadata()) {
      const links = metadata.querySelectorAll("ytd-channel-name a, #channel-name a");
      const a = Array.from(links).find((link) => isVideoControl(link) && link.textContent.trim());
      if (a) return { name: a.textContent.trim(), url: a.href || "" };
    }
    return { name: "", url: "" };
  }

  function isVisible(node) {
    if (!node) return false;
    if (node.offsetParent !== null) return true;
    return typeof node.getClientRects === "function" && node.getClientRects().length > 0;
  }

  function isVideoControl(node) {
    return !node.closest(PLAYLIST) && isVisible(node);
  }

  function findButtonPlacement() {
    let fallback = null;
    for (const metadata of getVisibleMetadata()) {
      for (const selector of ROW_SELECTORS) {
        for (const row of metadata.querySelectorAll(selector)) {
          if (isVideoControl(row)) return { row, fallback: null };
        }
      }
      if (!fallback) {
        fallback = Array.from(metadata.querySelectorAll("#above-the-fold")).find(isVideoControl) || metadata;
      }
    }
    return { row: null, fallback };
  }

  const mobile = YTM.createMobileDom({ document, getVideoId, isVideoControl, titleFromDocument });
  const desktop = { getVideoEl, getTitle, getChannel, findButtonPlacement };

  function adapter() {
    if (location.hostname === "m.youtube.com") return mobile;
    return !document.querySelector("ytd-watch-metadata") && document.querySelector("ytm-watch") ? mobile : desktop;
  }

  YTM.contentDom = {
    onWatchPage,
    getVideoId,
    getVideoEl: () => adapter().getVideoEl(),
    getTitle: () => adapter().getTitle(),
    getChannel: () => adapter().getChannel(),
    findButtonPlacement: () => adapter().findButtonPlacement(),
  };
})();
