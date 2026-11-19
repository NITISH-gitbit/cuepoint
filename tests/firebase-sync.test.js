const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/shared/schema");
const firebaseAuth = require("../src/storage/firebase-auth");
const { ACTIONS } = require("../src/shared/messages");
const { createSyncModel } = require("../src/background/sync-model");
const { createSyncManager } = require("../src/background/sync-manager");
const { createCoordinator } = require("../src/background/background");
const { createMemoryRepo } = require("./memory-repo");

const url = "https://cuepoint-test.firebaseio.com";
const model = createSyncModel(schema);
const credentials = (uid) => ({ uid, email: `${uid}@example.test`, idToken: `${uid}-token`,
  refreshToken: `${uid}-refresh`, expiresAt: Date.now() + 3_600_000, apiKey: "fake", databaseURL: url, enabled: true });
const defer = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function until(read, predicate = Boolean) {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(setImmediate);
  }
  throw new Error("Simulated sync did not reach expected state.");
}

function server() {
  const accounts = new Map();
  const area = (uid) => {
    if (!accounts.has(uid)) accounts.set(uid, new Map());
    return accounts.get(uid);
  };
  const open = new Set();
  let preconditionFailures = 0;
  function transportFor(control) {
    return ({ uid, getToken }) => {
      const videos = area(uid);
      const ready = async () => {
        const token = await getToken();
        if (control.offline) throw new Error("offline");
        return token;
      };
      const etag = (id) => String(videos.get(id)?.revision || 0);
      return {
        async listVideos() { await ready(); return [...videos.keys()]; },
        async readVideo(id) {
          await ready();
          await control.beforeRead?.(uid, id);
          return { document: structuredClone(videos.get(id) || null), etag: etag(id) };
        },
        async writeVideo(id, document, match) {
          await ready();
          await control.beforeWrite?.(document);
          if (match !== etag(id)) { preconditionFailures++; return false; }
          videos.set(id, structuredClone(document));
          for (const stream of open) if (stream.uid === uid) stream.onChange(id);
          await control.afterWrite?.(document);
          return true;
        },
        async subscribe(handlers) {
          const token = await ready();
          const stream = { uid, token, ...handlers };
          open.add(stream);
          control.streams.push(stream);
          handlers.onOpen();
          return { close() { open.delete(stream); } };
        },
      };
    };
  }
  return { area, transportFor, preconditionFailures: () => preconditionFailures };
}

function client(remote, uid = "alice", options = {}) {
  const connection = options.connection === undefined ? credentials(uid) : options.connection;
  const repo = options.repo || createMemoryRepo({ ...model.initialState(), connection });
  const control = { streams: [], ...options.control };
  const timers = new Map();
  let timerId = 0;
  const auth = {
    normalizeDatabaseUrl: firebaseAuth.normalizeDatabaseUrl,
    async signIn({ email }) { return credentials(email.split("@")[0]); },
    async refreshIdToken(config) { return { ...config, idToken: `${config.uid}-new`, expiresAt: Date.now() + 3_600_000 }; },
    ...options.auth,
  };
  const sync = createSyncManager({ repo, model, auth, createTransport: remote.transportFor(control),
    checkConsent: () => true,
    schedule(fn) { timers.set(++timerId, fn); return timerId; }, cancel(id) { timers.delete(id); } });
  const coordinator = createCoordinator({ repo, model, schema, actions: ACTIONS, sync });
  return { repo, control, sync, coordinator, timers,
    work: () => sync.syncNow(), status: () => sync.getStatus(),
    add: (timestamp, note = "") => coordinator.addMoment({ videoId: "videoA", timestamp, note }),
    list: () => coordinator.getMoments(),
    command: async (type, payload) => (await coordinator.handleMessage({ type, payload })).data,
    async signInAs(person) { return sync.connectWithCredentials({ email: `${person}@example.test`, apiKey: "fake", databaseURL: url, password: "fake" }); },
  };
}

test("an edit based on a version deleted by another client cannot resurrect a moment", async () => {
  const remote = server();
  const a = client(remote), b = client(remote);
  const m = await a.add(1, "original");
  await a.work();
  await b.work();
  const sent = defer(), release = defer();
  a.control.beforeWrite = () => { sent.resolve(); return release.promise; };
  await a.coordinator.updateMoment({ id: m.id, note: "keep my draft", baseVersion: m.version });
  await sent.promise;
  await b.coordinator.deleteMoment({ id: m.id, baseVersion: m.version });
  await b.work();
  release.resolve();
  await a.work();
  assert.equal(remote.preconditionFailures(), 1);
  assert.deepEqual(await a.list(), []);
  assert.deepEqual(await b.list(), []);
  const [conflict] = (await a.status()).conflicts;
  assert.equal(conflict.reason, "deleted");
  assert.equal(conflict.moment.note, "keep my draft");
});

test("two clients competing for the final slot keep the losing note as a conflict", async () => {
  const remote = server();
  const a = client(remote), b = client(remote);
  await a.add(1);
  await a.add(2);
  await a.work();
  await b.work();
  const arrived = defer(), release = defer();
  let count = 0;
  const pause = () => { if (++count === 2) arrived.resolve(); return release.promise; };
  a.control.beforeWrite = b.control.beforeWrite = pause;
  await Promise.all([a.add(3, "client A"), b.add(4, "client B")]);
  await arrived.promise;
  release.resolve();
  await Promise.all([a.work(), b.work()]);
  assert.equal(Object.keys(remote.area("alice").get("videoA").moments).length, 3);
  assert.deepEqual((await a.list()).map((m) => m.timestamp), (await b.list()).map((m) => m.timestamp));
  const clashes = [...(await a.status()).conflicts, ...(await b.status()).conflicts];
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].reason, "limit");
  const owner = clashes[0].moment.note === "client A" ? a : b;
  const first = (await owner.list()).find((m) => m.timestamp === 1);
  await owner.coordinator.deleteMoment({ id: first.id });
  await owner.command(ACTIONS.RESOLVE_SYNC_CONFLICT, { id: clashes[0].id, resolution: "retry", libraryKey: (await owner.status()).libraryKey });
  await owner.work();
  assert.equal((await owner.status()).conflicts.length, 0);
  assert.ok((await owner.list()).some((m) => m.note === clashes[0].moment.note));
});

test("the same timestamp cannot occupy two slots, and the losing note is preserved", async () => {
  const remote = server();
  const a = client(remote), b = client(remote, "alice", { control: { offline: true } });
  await b.add(15, "offline note");
  await a.add(15, "synced note");
  await a.work();
  b.control.offline = false;
  await b.work();
  assert.equal((await b.list()).length, 1);
  assert.equal((await b.list())[0].note, "synced note");
  assert.equal((await b.status()).conflicts[0].reason, "duplicate");
  assert.equal((await b.status()).conflicts[0].moment.note, "offline note");
});

test("a draft can be kept after a remote edit becomes visible, then explicitly applied", async () => {
  const remote = server();
  const a = client(remote), b = client(remote);
  const original = await a.add(16, "first version");
  await a.work();
  await b.work();
  await b.coordinator.updateMoment({ id: original.id, note: "Bob's update", baseVersion: original.version });
  await b.work();
  await a.work();
  const status = await a.status();
  const result = await a.coordinator.updateMoment({ id: original.id, note: "Alice's draft", baseVersion: original.version,
    baseMoment: original, libraryKey: status.libraryKey });
  assert.equal(result.pendingConflict, true);
  assert.equal((await a.list())[0].note, "Bob's update");
  const [conflict] = (await a.status()).conflicts;
  await a.command(ACTIONS.RESOLVE_SYNC_CONFLICT, { id: conflict.id, libraryKey: status.libraryKey, resolution: "retry" });
  await a.work();
  await b.work();
  assert.equal((await b.list())[0].note, "Alice's draft");
  assert.deepEqual((await a.status()).conflicts, []);
});

test("a lost write acknowledgement is replayed safely after a worker restart", async () => {
  const remote = server();
  const a = client(remote, "alice", { control: { afterWrite() { throw new Error("acknowledgement lost"); } } });
  await a.add(1, "once");
  await until(a.status, (s) => s.state === "error");
  assert.equal((await a.status()).pendingCount, 1);
  const committed = remote.area("alice").get("videoA");
  const restarted = client(remote, "alice", { repo: a.repo });
  await restarted.work();
  assert.equal((await restarted.status()).pendingCount, 0);
  assert.equal((await restarted.status()).state, "live");
  assert.deepEqual(remote.area("alice").get("videoA"), committed);
  assert.equal((await restarted.list()).length, 1);
});

test("a queued offline add and its subsequent edit survive restart in order", async () => {
  const remote = server();
  const a = client(remote, "alice", { control: { offline: true } });
  const original = await a.add(5, "initial");
  await a.coordinator.updateMoment({ id: original.id, note: "latest", baseVersion: original.version });
  assert.equal((await a.status()).pendingCount, 2);
  assert.equal((await a.list())[0].note, "latest");
  const restarted = client(remote, "alice", { repo: a.repo });
  await restarted.work();
  const document = remote.area("alice").get("videoA");
  assert.equal(document.revision, 2);
  assert.equal(document.moments[original.id].note, "latest");
  assert.equal((await restarted.status()).pendingCount, 0);
});

test("a refresh that finishes after sign-out cannot restore credentials or write", async () => {
  const remote = server(), refreshStarted = defer(), refresh = defer();
  const a = client(remote, "alice", { connection: { ...credentials("alice"), expiresAt: 0 }, auth: {
    async refreshIdToken() { refreshStarted.resolve(); return refresh.promise; },
  } });
  await a.sync.start();
  await refreshStarted.promise;
  await a.sync.signOut();
  refresh.resolve(credentials("alice"));
  await new Promise(setImmediate);
  assert.equal((await a.repo.read()).connection, null);
  assert.equal(a.control.streams.length, 0);
  assert.equal(remote.area("alice").size, 0);
});

test("account switching isolates libraries, stale stream events, and old editor commands", async () => {
  const remote = server();
  const a = client(remote);
  const privateMoment = await a.add(10, "Alice only");
  await a.work();
  const oldStream = a.control.streams[0];
  const oldKey = (await a.status()).libraryKey;
  await a.signInAs("bob");
  oldStream.onChange("videoA");
  await a.work();
  assert.deepEqual(await a.list(), []);
  assert.equal(remote.area("bob").size, 0);
  await assert.rejects(a.coordinator.updateMoment({ libraryKey: oldKey, id: privateMoment.id, note: "not for Bob" }), /active library changed/);
  await a.sync.setMode("local");
  await a.add(20, "local only");
  await a.sync.setMode("cloud");
  await a.work();
  assert.equal(remote.area("bob").size, 0);
  const libraryKey = (await a.status()).libraryKey;
  const imported = await a.command(ACTIONS.CLOUD_IMPORT_LOCAL, { libraryKey });
  assert.equal(imported.importResult.added, 1);
  await a.work();
  assert.deepEqual((await a.list()).map((m) => m.note), ["local only"]);
  await a.signInAs("alice");
  await a.work();
  assert.deepEqual((await a.list()).map((m) => m.note), ["Alice only"]);
});

test("rejected token is refreshed and transient refresh failures keep retrying", async () => {
  const remote = server();
  let attempts = 0;
  const a = client(remote, "alice", { auth: {
    async refreshIdToken(config) {
      if (++attempts === 1) throw new Error("temporary token outage");
      return { ...config, idToken: "renewed" };
    },
  } });
  await a.work();
  assert.equal(a.control.streams.length, 1);
  a.control.streams[0].onAuthRevoked();
  function fireRetry() {
    const [id, fn] = a.timers.entries().next().value;
    a.timers.delete(id);
    fn();
  }
  fireRetry();
  await until(() => a.timers.size > 0);
  assert.equal(a.control.streams.length, 1);
  fireRetry();
  await until(a.status, (s) => s.state === "live");
  assert.equal(a.control.streams[1].token, "renewed");
  assert.equal(attempts, 2);
});

test("sign-in does not commit an account whose database denies the initial read", async () => {
  const remote = server();
  const a = client(remote, "alice", { connection: null, control: { offline: true } });
  await assert.rejects(a.signInAs("alice"), /offline/);
  assert.equal((await a.repo.read()).connection, null);
  assert.equal((await a.status()).libraryKey, "local");
});

test("Firebase setup still parses pasted JavaScript config snippets", () => {
  assert.deepEqual(firebaseAuth.parseFirebaseConfigSnippet(`
    <script>const firebaseConfig = { apiKey: 'test', databaseURL: '${url}/', projectId: 'example' }; </script>
  `), { apiKey: "test", databaseURL: url, projectId: "example", valid: true });
  assert.equal(firebaseAuth.normalizeDatabaseUrl("https://example.invalid"), "");
});
