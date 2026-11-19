var YTM = YTM || {};

(function () {
  "use strict";

  const { createWriteQueue } = typeof module !== "undefined" && module.exports ? require("./queue") : YTM.queue;
  const stopped = () => new DOMException("Sync session retired.", "AbortError");

  function createSyncManager({ repo, model, auth, createTransport, onStatusChange,
    fetchFn = globalThis.fetch, EventSourceCtor, schedule = setTimeout, cancel = clearTimeout }) {
    let current = null;
    let authentication = null;
    let cloudSelected = false;
    let starting;
    const transitions = createWriteQueue();
    let publishing = null;
    let dirty = false;

    const owns = (session) => current === session && !session.controller.signal.aborted;
    function assertOwner(session) {
      if (!owns(session)) throw stopped();
    }

    function start() {
      if (!starting) {
        starting = repo.read().then((state) => {
          if (state.connection?.enabled) activate(state.connection);
          changed();
        }).catch((error) => { starting = null; throw error; });
      }
      return starting;
    }

    function statusFor(state) {
      const key = model.activeKey(state);
      const replica = model.library(state, key);
      const session = current?.key === key ? current : null;
      return {
        mode: state.connection?.enabled || cloudSelected ? "cloud" : "local",
        state: session?.phase || "local",
        hasCredentials: !!state.connection,
        libraryKey: key,
        email: state.connection?.email || "",
        databaseURL: state.connection?.databaseURL || "",
        lastSyncedAt: session?.lastSyncedAt || null,
        error: session?.error || "",
        pendingCount: replica.outbox.length,
        conflicts: replica.conflicts,
      };
    }

    function changed() {
      if (!onStatusChange) return;
      dirty = true;
      if (publishing) return;
      publishing = (async () => {
        while (dirty) {
          dirty = false;
          const state = await repo.read();
          await onStatusChange(statusFor(state), state.version);
        }
      })().catch(() => {}).finally(() => {
        publishing = null;
        if (dirty) changed();
      });
    }

    async function getStatus() {
      await start();
      return statusFor(await repo.read());
    }

    function transition(work) {
      return transitions.enqueue(async () => {
        await start();
        return work();
      });
    }

    function cancelAuthentication() {
      authentication?.abort();
      authentication = null;
    }

    function timedFetch(signal) {
      return (url, options = {}) => fetchFn(url, {
        ...options,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
    }

    function detach(session) {
      const stream = session.stream;
      session.stream = null;
      session.online = false;
      stream?.handle?.close();
    }

    function clearRetry(session) {
      if (session.timer !== null) cancel(session.timer);
      session.timer = null;
    }

    function retire() {
      const session = current;
      current = null;
      if (!session) return;
      clearRetry(session);
      detach(session);
      session.controller.abort();
    }

    function activate(connection) {
      retire();
      const controller = new AbortController();
      const session = {
        connection, controller, key: model.accountKey(connection), phase: "connecting",
        error: "", lastSyncedAt: null, refresh: null, tokenInvalid: false,
        stream: null, online: false, timer: null, failures: 0, running: null,
        full: true, invalidated: new Set(), requested: true, terminal: false,
      };
      current = session;
      session.transport = createTransport({ ...connection, EventSourceCtor, signal: controller.signal,
        fetchFn: timedFetch(controller.signal), getToken: () => getToken(session) });
      wake(session);
    }

    async function getToken(session) {
      assertOwner(session);
      const old = session.connection;
      if (!session.tokenInvalid && old.idToken && old.expiresAt > Date.now() + 60_000) return old.idToken;
      if (!session.refresh) {
        session.refresh = (async () => {
          const token = await auth.refreshIdToken(old, timedFetch(session.controller.signal));
          assertOwner(session);
          if (!token.idToken || (token.uid && token.uid !== old.uid)) {
            const error = new Error("Firebase returned credentials for a different session. Sign in again.");
            error.code = "INVALID_REFRESH_TOKEN";
            throw error;
          }
          const connection = { ...old, idToken: token.idToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt };
          await repo.commit((state) => {
            assertOwner(session);
            if (!state.connection?.enabled || model.accountKey(state.connection) !== session.key) throw stopped();
            state.connection = connection;
          });
          assertOwner(session);
          session.connection = connection;
          session.tokenInvalid = false;
          return connection.idToken;
        })().finally(() => { session.refresh = null; });
      }
      return session.refresh;
    }

    function retry(session, error) {
      if (!owns(session)) return;
      const terminal = ["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND"].includes(error.code);
      if (!terminal && session.timer !== null) return;
      session.phase = "error";
      session.error = error.message || "Cloud sync failed.";
      session.terminal = terminal;
      if (session.terminal) {
        clearRetry(session);
        detach(session);
      } else {
        const delay = Math.min(60_000, 1000 * 2 ** Math.min(session.failures++, 6));
        session.timer = schedule(() => {
          session.timer = null;
          session.requested = true;
          wake(session);
        }, delay);
      }
      changed();
    }

    async function ensureStream(session) {
      if (session.stream) return;
      const stream = { handle: null };
      session.stream = stream;
      const isCurrentStream = () => owns(session) && session.stream === stream;
      const disconnected = (error, revoked = false) => {
        if (!isCurrentStream()) return;
        detach(session);
        session.full = true;
        if (revoked) session.tokenInvalid = true;
        retry(session, error);
      };
      try {
        const handle = await session.transport.subscribe({
          onOpen: () => {
            if (!isCurrentStream()) return;
            session.online = true;
            session.full = true;
            wake(session);
          },
          onChange: (videoId) => {
            if (!isCurrentStream()) return;
            if (videoId === null) session.full = true;
            else if (model.safeKey(videoId)) session.invalidated.add(videoId);
            wake(session);
          },
          onAuthRevoked: () => disconnected(new Error("The Firebase stream token was rejected; reconnecting."), true),
          onCancel: () => disconnected(new Error("Firebase denied live sync. Check the database rules.")),
          onError: (error) => disconnected(error instanceof Error ? error : new Error("Firebase stream disconnected.")),
        });
        if (isCurrentStream()) stream.handle = handle;
        else handle.close();
      } catch (error) {
        if (isCurrentStream()) detach(session);
        throw error;
      }
    }

    async function applyNext(session, operation) {
      const { videoId } = operation.moment;
      for (let attempt = 0; attempt < 8; attempt++) {
        assertOwner(session);
        const response = await session.transport.readVideo(videoId);
        assertOwner(session);
        let document = model.normalizeVideo(videoId, response.document);
        const result = model.evaluate(document, operation);
        if (result.outcome === "write") {
          if (!(await session.transport.writeVideo(videoId, result.document, response.etag))) continue;
          document = result.document;
        }
        await repo.commit((state) => {
          assertOwner(session);
          model.settle(state, session.key, operation, document, result);
        });
        changed();
        return result.outcome;
      }
      throw new Error("This video is being updated on another device. Sync will retry.");
    }

    async function pull(session, videoId) {
      assertOwner(session);
      const { document } = await session.transport.readVideo(videoId);
      const video = model.normalizeVideo(videoId, document);
      return repo.commit((state) => {
        assertOwner(session);
        return model.installVideo(state, session.key, videoId, video);
      });
    }

    async function reconcile(session) {
      await ensureStream(session);
      let pushedCount = 0;
      let pulledCount = 0;
      do {
        assertOwner(session);
        session.requested = false;
        const state = await repo.read();
        assertOwner(session);
        const replica = model.library(state, session.key);
        const operation = replica.outbox[0];
        if (operation) {
          const outcome = await applyNext(session, operation);
          if (outcome === "write") pushedCount++;
          session.requested = true;
          continue;
        }
        if (session.full) {
          session.full = false;
          try {
            const keys = await session.transport.listVideos();
            assertOwner(session);
            for (const id of [...keys, ...Object.keys(replica.videos)]) {
              if (model.safeKey(id)) session.invalidated.add(id);
            }
          } catch (error) {
            session.full = true;
            throw error;
          }
        }
        const ids = [...session.invalidated];
        for (const id of ids) {
          session.invalidated.delete(id);
          try {
            if (await pull(session, id)) pulledCount++;
          } catch (error) {
            session.invalidated.add(id);
            throw error;
          }
        }
      } while (session.requested || session.full || session.invalidated.size);
      assertOwner(session);
      session.lastSyncedAt = Date.now();
      if (session.timer === null) {
        session.phase = session.online ? "live" : "connecting";
        session.error = "";
        if (session.online) session.failures = 0;
      }
      changed();
      return { pushedCount, pulledCount };
    }

    function run(session) {
      if (!owns(session)) return Promise.reject(stopped());
      if (!session.running) {
        session.running = reconcile(session).catch((error) => {
          if (owns(session) && (error.status === 401 || error.status === 403)) {
            session.tokenInvalid = true;
            detach(session);
          }
          retry(session, error);
          throw error;
        }).finally(() => {
          session.running = null;
          if (session.requested && session.timer === null) wake(session);
        });
      }
      return session.running;
    }

    function wake(session = current) {
      if (!session || !owns(session)) return;
      session.requested = true;
      if (session.timer === null && !session.terminal) run(session).catch(() => {});
    }

    async function connectWithCredentials({ apiKey, databaseURL, email, password, isSignUp }) {
      cancelAuthentication();
      const attempt = new AbortController();
      authentication = attempt;
      try {
        await start();
        const key = typeof apiKey === "string" ? apiKey.trim() : "";
        const url = auth.normalizeDatabaseUrl(databaseURL);
        const address = typeof email === "string" ? email.trim() : "";
        if (!key || !url || !address || typeof password !== "string" || !password) {
          throw new Error("A Firebase API key, database URL, email, and password are required.");
        }
        const request = isSignUp ? auth.signUp : auth.signIn;
        const fetch = timedFetch(attempt.signal);
        const token = await request({ apiKey: key, email: address, password }, fetch);
        attempt.signal.throwIfAborted();
        if (!token.uid || !token.idToken || !token.refreshToken) throw new Error("Firebase returned an incomplete session.");
        const connection = { ...token, apiKey: key, databaseURL: url, enabled: true };
        const probe = createTransport({ ...connection, getToken: async () => token.idToken, fetchFn: fetch, signal: attempt.signal });
        await probe.listVideos();
        return await transition(async () => {
          attempt.signal.throwIfAborted();
          retire();
          await repo.commit((state) => {
            attempt.signal.throwIfAborted();
            state.connection = connection;
            state.version++;
          });
          activate(connection);
          cloudSelected = false;
          changed();
          return getStatus();
        });
      } finally {
        if (authentication === attempt) authentication = null;
      }
    }

    function setMode(mode) {
      if (mode !== "cloud" && mode !== "local") throw new Error("Unsupported sync mode.");
      cancelAuthentication();
      return transition(async () => {
        const before = await repo.read();
        const enabled = mode === "cloud";
        cloudSelected = enabled && !before.connection;
        if (before.connection && before.connection.enabled !== enabled) {
          retire();
          const connection = await repo.commit((state) => {
            state.connection = { ...state.connection, enabled };
            state.version++;
            return state.connection;
          });
          if (enabled) activate(connection);
        }
        changed();
        return getStatus();
      });
    }

    function signOut() {
      cancelAuthentication();
      return transition(async () => {
        retire();
        await repo.commit((state) => { state.connection = null; state.version++; });
        cloudSelected = false;
        changed();
        return getStatus();
      });
    }

    async function syncNow() {
      await start();
      const session = current;
      if (!session) throw new Error("Cloud sync is not signed in.");
      clearRetry(session);
      session.terminal = false;
      session.full = true;
      session.requested = true;
      const syncResult = await run(session);
      assertOwner(session);
      return { ...await getStatus(), syncResult };
    }

    async function recover() {
      await start();
      if (current && !current.terminal && current.timer === null) {
        if (!current.online) current.full = true;
        wake();
      }
    }

    return { start, changed, wake, getStatus, connectWithCredentials, setMode, signOut, syncNow, recover };
  }

  YTM.syncManager = { createSyncManager };
  if (typeof module !== "undefined" && module.exports) module.exports = YTM.syncManager;
})();
