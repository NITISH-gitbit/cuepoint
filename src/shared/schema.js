var YTM = YTM || {};

(function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_MOMENTS_PER_VIDEO = 3;

  const ALLOWED_YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);

  function newId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function sanitizeUrl(raw, { requireYouTubeHost = false } = {}) {
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return "";
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }

    if (requireYouTubeHost && !ALLOWED_YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return "";
    }

    return parsed.href;
  }

  function extractVideoId(rawUrl) {
    const safeUrl = sanitizeUrl(rawUrl, { requireYouTubeHost: true });
    if (!safeUrl) return "";

    try {
      const u = new URL(safeUrl);
      const host = u.hostname.toLowerCase();
      if (host === "youtu.be") {
        return u.pathname.replace(/^\/+/, "").split("/")[0] || "";
      }
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") && parts[1]) {
        return parts[1];
      }
    } catch {
      return "";
    }
    return "";
  }

  function buildWatchUrl(videoId, timestamp) {
    const ts = Math.max(0, Math.floor(Number(timestamp) || 0));
    const cleanId = typeof videoId === "string" ? videoId.trim() : "";
    if (!cleanId) return "";
    const u = new URL("https://www.youtube.com/watch");
    u.searchParams.set("v", cleanId);
    u.searchParams.set("t", `${ts}s`);
    return u.href;
  }

  function createMoment({
    videoId,
    timestamp,
    title = "",
    channelName = "",
    channelUrl = "",
    note = "",
  }) {
    const ts = Math.max(0, Math.floor(Number(timestamp) || 0));
    const cleanId = typeof videoId === "string" ? videoId.trim() : "";
    const url = buildWatchUrl(cleanId, ts);
    if (!url) {
      throw new Error("Cannot create moment without a valid videoId");
    }

    const now = Date.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: newId(),
      videoId: cleanId,
      url,
      timestamp: ts,
      title: typeof title === "string" ? title.trim() : "",
      channelName: typeof channelName === "string" ? channelName.trim() : "",
      channelUrl: sanitizeUrl(channelUrl, { requireYouTubeHost: true }),
      note: typeof note === "string" ? note.trim() : "",
      savedAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  function normalizeMoment(raw) {
    if (!raw || typeof raw !== "object") return null;

    const url = sanitizeUrl(raw.url, { requireYouTubeHost: true });
    const rawTs = Number(raw.timestamp);
    if (!url || !Number.isFinite(rawTs) || rawTs < 0) return null;

    const videoId =
      typeof raw.videoId === "string" && raw.videoId.trim()
        ? raw.videoId.trim()
        : extractVideoId(url);

    const rawSavedAt = Number(raw.savedAt);
    const savedAt = Number.isFinite(rawSavedAt) && rawSavedAt > 0 ? rawSavedAt : Date.now();

    const rawUpdatedAt = Number(raw.updatedAt);
    const updatedAt =
      Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0 ? rawUpdatedAt : savedAt;

    const rawDeletedAt = Number(raw.deletedAt);
    const deletedAt =
      raw.deletedAt !== null && raw.deletedAt !== undefined && Number.isFinite(rawDeletedAt) && rawDeletedAt > 0
        ? rawDeletedAt
        : null;

    return {
      schemaVersion: SCHEMA_VERSION,
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : newId(),
      videoId,
      url,
      timestamp: Math.floor(rawTs),
      title: typeof raw.title === "string" ? raw.title : "",
      channelName: typeof raw.channelName === "string" ? raw.channelName : "",
      channelUrl: sanitizeUrl(raw.channelUrl, { requireYouTubeHost: true }),
      note: typeof raw.note === "string" ? raw.note : "",
      savedAt,
      updatedAt,
      deletedAt,
    };
  }

  function isActiveMoment(m) {
    return !!m && !m.deletedAt;
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function formatDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  const api = {
    SCHEMA_VERSION,
    MAX_MOMENTS_PER_VIDEO,
    ALLOWED_YOUTUBE_HOSTS,
    newId,
    sanitizeUrl,
    extractVideoId,
    buildWatchUrl,
    createMoment,
    normalizeMoment,
    isActiveMoment,
    formatTime,
    formatDate,
  };

  YTM.schema = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
