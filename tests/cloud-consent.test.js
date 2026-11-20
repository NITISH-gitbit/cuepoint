const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../manifest.json");
const { createCloudConsent } = require("../src/shared/cloud-consent");
const { createSyncManager } = require("../src/background/sync-manager");
const { createSyncModel } = require("../src/background/sync-model");
const { createFirebaseTransport } = require("../src/storage/firebase-rtdb");
const auth = require("../src/storage/firebase-auth");
const schema = require("../src/shared/schema");
const { createMemoryRepo } = require("./memory-repo");

const declared = {
  data_collection: ["authenticationInfo", "browsingActivity", "personalCommunications", "personallyIdentifyingInfo", "websiteContent"],
  origins: ["https://identitytoolkit.googleapis.com/*", "https://securetoken.googleapis.com/*",
    "https://*.firebaseio.com/*", "https://*.firebasedatabase.app/*"],
};

function permissionApi() {
  let grants = structuredClone(declared);
  let acceptRequest = true;
  const calls = [];
  const consent = createCloudConsent({ runtime: { getManifest: () => manifest }, permissions: {
    async getAll() { return grants; },
    async contains(request) {
      calls.push(["contains", request]);
      // Older Firefox can ignore a data_collection parameter to contains().
      return request.origins.every((origin) => grants.origins.includes(origin));
    },
    async request(request) {
      calls.push(["request", request]);
      return acceptRequest;
    },
  } });
  return { consent, calls, setGrants(value) { grants = value; }, deny() { acceptRequest = false; } };
}

test("manifest requires no collection and the user-gesture request covers every optional cloud permission", async () => {
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["none"]);
  assert.equal(manifest.browser_specific_settings.gecko_android.strict_min_version, "142.0");
  const { consent, calls } = permissionApi();
  const request = consent.request();
  assert.deepEqual(calls, [["request", declared]]);
  await request;
  assert.deepEqual(calls, [["request", declared], ["contains", declared]]);
  assert.equal(consent.affectsCloud({ data_collection: ["websiteContent"] }), true);
  assert.equal(consent.affectsCloud({ origins: ["https://test.firebaseio.com/*"] }), true);
  assert.equal(consent.affectsCloud({ permissions: ["storage"], data_collection: [] }), false);
});

test("missing, partial, rejected, or unsupported grants never authorize Cloud Sync", async () => {
  const { consent, calls, setGrants, deny } = permissionApi();
  setGrants({ origins: declared.origins });
  assert.equal(await consent.isGranted(), false);
  assert.deepEqual(calls, []);
  await assert.rejects(consent.request(), /data consent is unavailable/);
  setGrants({ ...declared, data_collection: declared.data_collection.slice(1) });
  assert.equal(await consent.isGranted(), false);
  setGrants({ ...declared, origins: declared.origins.slice(1) });
  assert.equal(await consent.isGranted(), false);
  deny();
  await assert.rejects(consent.request(), /data and network permissions are required/);
});

const model = createSyncModel(schema);
const databaseURL = "https://cuepoint-consent-test.firebaseio.com";
const credentials = { apiKey: "test-key", databaseURL, email: "person@example.test", password: "test-password" };
const account = { enabled: true, apiKey: credentials.apiKey, databaseURL, email: credentials.email, uid: "test-user",
  idToken: "test-token", refreshToken: "test-refresh", expiresAt: Date.now() + 3600_000 };
const deferred = () => Promise.withResolvers();
const tick = () => new Promise(setImmediate);

async function until(read) {
  for (let i = 0; i < 100; i++) {
    const result = await read();
    if (result) return result;
    await tick();
  }
  throw new Error("Test did not reach the expected sync state");
}

function simulator({ repo = createMemoryRepo({ ...model.initialState(), connection: account }), granted = true,
  respond, checkConsent } = {}) {
  const calls = [], streams = [], timers = new Set();
  let checks = 0;
  class FakeStream {
    constructor(url) { this.url = url; streams.push(this); }
    close() { this.closed = true; }
    addEventListener() {}
  }
  const sync = createSyncManager({ repo, model, auth, createTransport: createFirebaseTransport, EventSourceCtor: FakeStream,
    checkConsent: () => { checks++; return checkConsent ? checkConsent() : granted; },
    schedule(fn) { timers.add(fn); return fn; }, cancel(fn) { timers.delete(fn); },
    async fetchFn(url, options) {
      calls.push({ url, ...options });
      const response = await respond?.(url, options);
      return response || new Response("null", { headers: { ETag: "0" } });
    },
  });
  return { repo, sync, calls, streams, timers, checks: () => checks, setGranted(value) { granted = value; } };
}

async function queueMoment(repo) {
  const moment = schema.createMoment({ videoId: "abcdefghijk", timestamp: 4, note: "pending private text" });
  await repo.commit((state) => model.change(state, model.accountKey(account), "add", moment));
  return moment;
}

test("startup without consent pauses an existing account; granting later does not send anything until explicit resume", async () => {
  const { repo, sync, calls, streams, setGranted } = simulator({ granted: false });
  await queueMoment(repo);
  await sync.start();
  assert.equal((await repo.read()).connection.enabled, false);
  assert.equal((await sync.getStatus()).libraryKey, model.LOCAL);
  for (const isSignUp of [true, false]) {
    await assert.rejects(sync.connectWithCredentials({ ...credentials, isSignUp }), /permissions are required/);
  }
  await assert.rejects(sync.setMode("cloud"), /permissions are required/);
  await sync.recover();
  setGranted(true);
  await sync.recover();
  const restarted = simulator({ repo });
  await restarted.sync.recover();
  assert.deepEqual(calls, []);
  assert.deepEqual(streams, []);
  assert.deepEqual(restarted.calls, []);
  await restarted.sync.setMode("cloud");
  await restarted.sync.syncNow();
  assert.equal(restarted.calls.filter(({ method }) => method === "PUT").length, 1);
  assert.equal((await restarted.sync.getStatus()).pendingCount, 0);
});

test("revocation immediately closes the stream and aborts an in-flight upload without dropping the outbox", async () => {
  const sent = deferred(), response = deferred();
  const { repo, sync, calls, streams, timers, setGranted } = simulator({
    respond(_url, { method, signal }) {
      if (method === "PUT") { sent.resolve(signal); return response.promise; }
    },
  });
  const moment = await queueMoment(repo);
  await sync.start();
  const signal = await sent.promise;
  setGranted(false);
  const paused = sync.pauseForConsent();
  assert.equal(signal.aborted, true);
  assert.equal(streams[0].closed, true);
  await paused;
  response.resolve(new Response("null"));
  await tick();
  assert.equal((await sync.getStatus()).mode, "local");
  assert.equal((await repo.read()).libraries[model.accountKey(account)].outbox[0].moment.id, moment.id);
  assert.equal(timers.size, 0);
  const sentCount = calls.length;
  setGranted(true);
  sync.wake();
  await sync.recover();
  await assert.rejects(sync.syncNow(), /paused/);
  assert.equal(calls.length, sentCount);
  assert.equal(streams.length, 1);
});

test("revocation invalidates a pending resume even if the permission check returns an old grant", async () => {
  const checked = deferred(), granted = deferred();
  const repo = createMemoryRepo({ ...model.initialState(), connection: { ...account, enabled: false } });
  const { sync, calls, streams } = simulator({ repo, checkConsent() { checked.resolve(); return granted.promise; } });
  const resume = sync.setMode("cloud");
  const rejected = assert.rejects(resume, /permissions are required/);
  await checked.promise;
  const paused = sync.pauseForConsent();
  granted.resolve(true);
  await rejected;
  await paused;
  assert.equal((await repo.read()).connection.enabled, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(streams, []);
});

test("revocation aborts pending sign-in and a late auth response cannot start a probe or session", async () => {
  const sent = deferred(), response = deferred();
  const repo = createMemoryRepo(model.initialState());
  const { sync, calls, streams } = simulator({ repo,
    respond(_url, { signal }) { sent.resolve(signal); return response.promise; },
  });
  const signIn = sync.connectWithCredentials(credentials);
  const rejected = assert.rejects(signIn, /permissions are required/);
  const signal = await sent.promise;
  await sync.pauseForConsent();
  assert.equal(signal.aborted, true);
  response.resolve(Response.json({ localId: account.uid, idToken: account.idToken, refreshToken: account.refreshToken }));
  await rejected;
  assert.equal((await repo.read()).connection, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(streams, []);
});

test("each database request checks consent, so a late grant loss cannot turn a read into a write", async () => {
  const client = simulator({
    respond(url) {
      if (url.includes("/abcdefghijk.json")) client.setGranted(false);
    },
  });
  await queueMoment(client.repo);
  await client.sync.start();
  await until(async () => !(await client.repo.read()).connection.enabled);
  assert.deepEqual(client.calls.map(({ method }) => method), ["GET"]);
  assert.equal(client.streams[0].closed, true);
  assert.equal((await client.repo.read()).libraries[model.accountKey(account)].outbox.length, 1);
});

test("revocation during sign-in database probe reports the consent error rather than transport abort", async () => {
  const probeStarted = deferred(), probeResponse = deferred();
  const repo = createMemoryRepo(model.initialState());
  const { sync, streams } = simulator({
    repo,
    respond(url, { signal }) {
      if (url.includes("identitytoolkit.googleapis.com")) {
        return Response.json({ localId: account.uid, idToken: account.idToken, refreshToken: account.refreshToken });
      }
      probeStarted.resolve(signal);
      return probeResponse.promise;
    },
  });
  const signIn = sync.connectWithCredentials(credentials);
  const rejected = assert.rejects(signIn, /permissions are required/);
  const signal = await probeStarted.promise;
  await sync.pauseForConsent();
  assert.equal(signal.aborted, true);
  probeResponse.resolve(new Response("null"));
  await rejected;
  assert.equal((await repo.read()).connection, null);
  assert.deepEqual(streams, []);
});

test("recovery detects missing consent even without onRemoved and invalidates scheduled retries", async () => {
  const { sync, calls, streams, timers, setGranted } = simulator({ respond() { throw new Error("offline"); } });
  await sync.start();
  const timer = await until(() => timers.values().next().value);
  assert.equal((await sync.getStatus()).state, "error");
  const attempted = calls.length;
  setGranted(false);
  await assert.rejects(sync.recover(), /permissions are required/);
  await sync.ready();
  assert.equal(timers.size, 0);
  assert.equal(streams[0].closed, true);
  setGranted(true);
  timer(); // An already-dispatched retry callback must also remain inert.
  await sync.recover();
  assert.equal(calls.length, attempted);
});
