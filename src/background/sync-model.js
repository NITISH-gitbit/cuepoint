var YTM = YTM || {};

(function () {
  "use strict";

  function createSyncModel(schema) {
    const LOCAL = "local";
    const limit = schema.MAX_MOMENTS_PER_VIDEO;
    const has = (object, key) => Object.hasOwn(object, key);
    const safeKey = (key) => typeof key === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(key) &&
      !["__proto__", "constructor", "prototype"].includes(key);
    const accountKey = ({ databaseURL, uid }) => `firebase:${databaseURL}|${uid}`;
    const activeKey = (state) => state.connection?.enabled ? accountKey(state.connection) : LOCAL;
    const emptyLibrary = () => ({ videos: {}, outbox: [], conflicts: [] });
    const library = (state, key) => state.libraries[key] || (state.libraries[key] = emptyLibrary());
    const initialState = () => ({
      clientId: schema.newId(), nextSequence: 0, version: 0, connection: null,
      libraries: { [LOCAL]: emptyLibrary() },
    });

    function normalizeVideo(videoId, document) {
      if (document === null) return null;
      if (!safeKey(videoId) || document?.videoId !== videoId ||
          !Number.isSafeInteger(document.revision) || document.revision < 1) {
        throw new Error("Invalid video record in Firebase.");
      }
      const moments = {};
      const spots = new Set();
      for (const [id, value] of Object.entries(document.moments || {})) {
        const moment = schema.normalizeMoment(value);
        if (!safeKey(id) || !moment || id !== moment.id || videoId !== moment.videoId ||
            !safeKey(value.version) || !schema.isActiveMoment(moment) || spots.has(moment.timestamp)) {
          throw new Error("Invalid moment record in Firebase.");
        }
        spots.add(moment.timestamp);
        moments[id] = { ...moment, version: value.version };
      }
      if (spots.size > limit) throw new Error("Firebase video exceeds the saved moment limit.");
      const applied = {};
      for (const [client, sequence] of Object.entries(document.applied || {})) {
        if (!safeKey(client) || !Number.isSafeInteger(sequence) || sequence < 1) {
          throw new Error("Invalid operation receipt in Firebase.");
        }
        applied[client] = sequence;
      }
      return { videoId, revision: document.revision, moments, applied };
    }

    function evaluate(document, operation) {
      const { clientId, sequence, kind, moment, baseVersion, id } = operation;
      const previous = document || { videoId: moment.videoId, revision: 0, moments: {}, applied: {} };
      // Each client settles one operation before sending the next, so a high-water receipt covers replays.
      if ((previous.applied[clientId] || 0) >= sequence) return { outcome: "already-applied" };
      const records = previous.moments;
      const current = has(records, moment.id) ? records[moment.id] : null;
      if (kind === "add") {
        if (current || Object.values(records).some((other) => other.timestamp === moment.timestamp)) {
          return { outcome: "conflict", reason: "duplicate" };
        }
        if (Object.keys(records).length >= limit) return { outcome: "conflict", reason: "limit" };
      } else if (!current) {
        return kind === "delete" ? { outcome: "already-applied" } : { outcome: "conflict", reason: "deleted" };
      } else if (current.version !== baseVersion) {
        return { outcome: "conflict", reason: "changed" };
      }
      const moments = { ...records };
      if (kind === "delete") delete moments[moment.id];
      else moments[moment.id] = { ...moment, version: id };
      return {
        outcome: "write",
        document: {
          videoId: moment.videoId,
          revision: previous.revision + 1,
          moments,
          applied: { ...previous.applied, [clientId]: sequence },
        },
      };
    }

    function visibleVideos(replica) {
      const videos = { ...replica.videos };
      for (const operation of replica.outbox) {
        const { videoId } = operation.moment;
        const result = evaluate(has(videos, videoId) ? videos[videoId] : null, operation);
        if (result.outcome === "write") videos[videoId] = result.document;
      }
      return videos;
    }

    function listMoments(replica) {
      return Object.values(visibleVideos(replica)).flatMap((document) => Object.values(document.moments));
    }

    function change(state, key, kind, moment, baseVersion = null) {
      const replica = library(state, key);
      const sequence = ++state.nextSequence;
      const operation = { id: `${state.clientId}_${sequence}`, clientId: state.clientId, sequence, kind, moment, baseVersion };
      if (key === LOCAL) {
        const result = evaluate(has(replica.videos, moment.videoId) ? replica.videos[moment.videoId] : null, operation);
        if (result.outcome !== "write") throw new Error("Local change conflicts with the library.");
        replica.videos[moment.videoId] = result.document;
      } else {
        replica.outbox.push(operation);
      }
      state.version++;
      return { ...moment, version: operation.id };
    }

    function installVideo(state, key, videoId, document) {
      const videos = library(state, key).videos;
      const previous = has(videos, videoId) ? videos[videoId] : null;
      if (!document) {
        if (!previous) return false;
        delete videos[videoId];
      } else {
        if (previous && previous.revision >= document.revision) return false;
        videos[videoId] = document;
      }
      state.version++;
      return true;
    }

    function settle(state, key, operation, document, result) {
      const replica = library(state, key);
      if (replica.outbox[0]?.id !== operation.id) return;
      installVideo(state, key, operation.moment.videoId, document);
      replica.outbox.shift();
      if (result.outcome === "conflict") {
        replica.conflicts.push({ id: operation.id, kind: operation.kind, reason: result.reason, moment: operation.moment });
      }
      state.version++;
    }

    return { LOCAL, limit, safeKey, accountKey, activeKey, library, initialState, normalizeVideo,
      evaluate, listMoments, change, installVideo, settle };
  }

  YTM.syncModel = { createSyncModel };
  if (typeof module !== "undefined" && module.exports) module.exports = YTM.syncModel;
})();
