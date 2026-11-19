var YTM = YTM || {};

(function () {
  "use strict";

  const ROW_SELECTORS = [
    "ytd-watch-metadata #top-level-buttons-computed",
    "ytd-watch-metadata #actions #menu #top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner #menu",
    "#top-level-buttons-computed",
  ];

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

  function findActionRow() {
    for (const sel of ROW_SELECTORS) {
      for (const node of document.querySelectorAll(sel)) {
        if (isVisible(node)) return node;
      }
    }
    return null;
  }

  function findFallbackMount() {
    return (
      document.querySelector("ytd-watch-metadata #above-the-fold") ||
      document.querySelector("ytd-watch-metadata") ||
      null
    );
  }

  YTM.contentDom = {
    onWatchPage,
    getVideoId,
    getVideoEl,
    getTitle,
    getChannel,
    findActionRow,
    findFallbackMount,
  };
})();
