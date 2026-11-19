var YTM = YTM || {};

(function () {
  "use strict";

  function transportError(message, status = 0) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function abortError() {
    const error = transportError("Firebase transport was aborted");
    error.name = "AbortError";
    return error;
  }

  function assertActive(signal) {
    if (signal?.aborted) throw abortError();
  }

  // Stream payloads are only hints to re-read, never authoritative documents.
  function changedVideo(event, isPatch) {
    const payload = JSON.parse(event.data);
    if (!payload || typeof payload.path !== "string" || !payload.path.startsWith("/")
        || !Object.prototype.hasOwnProperty.call(payload, "data")) {
      throw new Error("Invalid Firebase stream payload");
    }
    const path = payload.path.slice(1);
    if (path && path.split("/").some((part) => !part)) {
      throw new Error("Invalid Firebase stream path");
    }
    if (!isPatch) return path.split("/")[0] || null;

    if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      throw new Error("Invalid Firebase stream patch");
    }
    const keys = Object.keys(payload.data);
    if (keys.some((key) => key.split("/").some((part) => !part))) {
      throw new Error("Invalid Firebase stream patch path");
    }
    if (path) return path.split("/")[0];
    const videoIds = new Set(keys.map((key) => key.split("/")[0]));
    return videoIds.size === 1 ? videoIds.values().next().value : null;
  }

  function createFirebaseTransport({
    databaseURL,
    uid,
    getToken,
    fetchFn = fetch,
    EventSourceCtor = typeof EventSource === "undefined" ? null : EventSource,
    signal,
  }) {
    const root = `${databaseURL.replace(/\/+$/, "")}/users/${encodeURIComponent(uid)}/cuepointV2/videos`;

    async function requestUrl(videoId, query = "") {
      assertActive(signal);
      let token;
      try {
        token = await getToken();
      } catch (error) {
        assertActive(signal);
        const terminal = ["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND"].includes(error?.code);
        const failure = transportError(terminal ? "Firebase session expired. Sign in again." : "Could not obtain a Firebase token");
        if (terminal) failure.code = error.code;
        throw failure;
      }
      assertActive(signal);
      if (typeof token !== "string" || !token) {
        throw transportError("Firebase token is missing");
      }
      const path = videoId === undefined ? root : `${root}/${encodeURIComponent(videoId)}`;
      return `${path}.json?auth=${encodeURIComponent(token)}${query}`;
    }

    async function request(url, options) {
      assertActive(signal);
      let response;
      try {
        response = await fetchFn(url, { ...options, signal });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw abortError();
        // A network error can include the URL (and its auth query parameter).
        throw transportError("Firebase request could not reach the database", Number.isInteger(error?.status) ? error.status : 0);
      }
      assertActive(signal);
      return response;
    }

    function checkResponse(response) {
      if (!response.ok) {
        throw transportError(`Firebase request failed (HTTP ${response.status})`, response.status);
      }
    }

    async function readJson(response) {
      try {
        const data = await response.json();
        assertActive(signal);
        return data;
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw abortError();
        throw transportError("Invalid JSON in Firebase response", response.status);
      }
    }

    return {
      async listVideos() {
        const response = await request(await requestUrl(undefined, "&shallow=true"), { method: "GET" });
        checkResponse(response);
        const data = await readJson(response);
        if (data === null) return [];
        if (typeof data !== "object" || Array.isArray(data)) {
          throw transportError("Invalid Firebase video list", response.status);
        }
        return Object.keys(data);
      },

      async readVideo(videoId) {
        const response = await request(await requestUrl(videoId), {
          method: "GET",
          headers: { "X-Firebase-ETag": "true" },
        });
        checkResponse(response);
        const etag = response.headers.get("ETag");
        if (!etag) throw transportError("Firebase response did not include an ETag", response.status);
        return { document: await readJson(response), etag };
      },

      async writeVideo(videoId, document, etag) {
        if (typeof etag !== "string" || !etag.trim()) {
          throw transportError("A Firebase ETag is required for a conditional write");
        }
        const response = await request(await requestUrl(videoId), {
          method: "PUT",
          headers: { "Content-Type": "application/json", "if-match": etag },
          body: JSON.stringify(document),
        });
        if (response.status === 412) return false;
        checkResponse(response);
        return true;
      },

      async subscribe({ onOpen, onChange, onError, onAuthRevoked, onCancel }) {
        assertActive(signal);
        if (!EventSourceCtor) throw transportError("EventSource is unavailable in this environment");
        const url = await requestUrl();
        assertActive(signal);
        let stream;
        try {
          stream = new EventSourceCtor(url);
        } catch {
          throw transportError("Could not open the Firebase stream");
        }

        let closed = false;
        function close() {
          if (closed) return;
          closed = true;
          signal?.removeEventListener("abort", close);
          stream.close();
        }
        signal?.addEventListener("abort", close, { once: true });
        if (signal?.aborted) {
          close();
          throw abortError();
        }

        function invalidate(event, isPatch) {
          if (closed) return;
          let videoId;
          try {
            videoId = changedVideo(event, isPatch);
          } catch {
            onError?.(transportError("Malformed Firebase stream event"));
            return;
          }
          onChange?.(videoId);
        }

        stream.addEventListener("open", () => {
          if (!closed) onOpen?.();
        });
        stream.addEventListener("put", (event) => invalidate(event, false));
        stream.addEventListener("patch", (event) => invalidate(event, true));
        stream.addEventListener("auth_revoked", () => {
          if (closed) return;
          close();
          onAuthRevoked?.();
        });
        stream.addEventListener("cancel", () => {
          if (closed) return;
          close();
          onCancel?.();
        });
        stream.onerror = () => {
          if (!closed) onError?.(transportError("Firebase stream connection failed"));
        };
        return { close };
      },
    };
  }

  const api = { createFirebaseTransport };
  YTM.firebaseRtdb = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
