var YTM = YTM || {};

(function () {
  "use strict";

  const ROW_SELECTORS = [
    "#actions #top-level-buttons-computed",
    "#actions-inner #top-level-buttons-computed",
    "#actions #menu",
    "#actions-inner #menu",
  ];
  const PLAYLIST = "ytd-playlist-panel-renderer, ytd-playlist-header-renderer";

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

  function getTitle() {
    const el = document.querySelector(
      "h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata",
    );
    if (el && el.textContent.trim()) return el.textContent.trim();
    return document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  }

  function getChannel() {
    const a = document.querySelector(
      "ytd-watch-metadata ytd-channel-name a, ytd-watch-metadata #channel-name a",
    );
    if (a && a.textContent.trim()) {
      return { name: a.textContent.trim(), url: a.href || "" };
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
    for (const metadata of document.querySelectorAll("ytd-watch-metadata")) {
      if (!isVideoControl(metadata)) continue;
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

  YTM.contentDom = {
    onWatchPage,
    getVideoId,
    getVideoEl,
    getTitle,
    getChannel,
    findButtonPlacement,
  };
})();
