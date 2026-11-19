var YTM = YTM || {};

(function () {
  "use strict";

  const ALL_PAGE_SIZE = Number.MAX_SAFE_INTEGER;

  function parsePageSize(raw) {
    if (raw === "all") return ALL_PAGE_SIZE;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  function filterAndSort(moments, query) {
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    const items = q
      ? moments.filter(
          (m) =>
            (m.note || "").toLowerCase().includes(q) ||
            (m.title || "").toLowerCase().includes(q) ||
            (m.channelName || "").toLowerCase().includes(q),
        )
      : moments.slice();

    items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return items;
  }

  function groupByVideo(moments) {
    const byVideo = new Map();

    for (const m of moments) {
      const key = m.videoId || m.id;
      let group = byVideo.get(key);
      if (!group) {
        group = {
          videoId: m.videoId || "",
          key,
          title: m.title || "(untitled video)",
          channelName: m.channelName || "",
          channelUrl: m.channelUrl || "",
          url: m.url,
          latestSavedAt: m.savedAt || 0,
          moments: [],
        };
        byVideo.set(key, group);
      } else {
        if (!group.title || group.title === "(untitled video)") {
          if (m.title) group.title = m.title;
        }
        if (!group.channelName && m.channelName) group.channelName = m.channelName;
        if (!group.channelUrl && m.channelUrl) group.channelUrl = m.channelUrl;
        if ((m.savedAt || 0) > group.latestSavedAt) {
          group.latestSavedAt = m.savedAt || 0;
        }
      }
      group.moments.push(m);
    }

    const groups = Array.from(byVideo.values());
    for (const g of groups) {
      g.moments.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
    groups.sort((a, b) => b.latestSavedAt - a.latestSavedAt);
    return groups;
  }

  function paginate(items, requestedPage, pageSize) {
    const size = pageSize > 0 ? pageSize : 10;
    const totalPages = Math.max(1, Math.ceil(items.length / size));
    const currentPage = Math.min(Math.max(1, requestedPage || 1), totalPages);
    const start = (currentPage - 1) * size;
    const pageItems = items.slice(start, start + size);
    return { pageItems, currentPage, totalPages };
  }

  function pageWindow(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const out = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) out.push("…");
    for (let i = start; i <= end; i++) out.push(i);
    if (end < total - 1) out.push("…");
    out.push(total);
    return out;
  }

  const api = {
    ALL_PAGE_SIZE,
    parsePageSize,
    filterAndSort,
    groupByVideo,
    paginate,
    pageWindow,
  };

  YTM.momentsState = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
