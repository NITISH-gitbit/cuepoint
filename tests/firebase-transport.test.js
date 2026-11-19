const test = require("node:test");
const assert = require("node:assert/strict");
const { createFirebaseTransport } = require("../src/storage/firebase-rtdb.js");

const TOKEN = "test+token";
const ROOT = "/users/example%20uid/cuepointV2/videos";

function createTransport(options = {}) {
  return createFirebaseTransport({
    databaseURL: "https://database.invalid/",
    uid: "example uid",
    getToken: async () => TOKEN,
    ...options,
  });
}

function mockRest(...responses) {
  const requests = [];
  const transport = createTransport({
    async fetchFn(url, options) {
      requests.push({ url: new URL(url), ...options });
      assert.ok(responses.length, "unexpected REST request");
      return responses.shift();
    },
  });
  return { transport, requests };
}

function mockStream(options = {}) {
  let stream;
  class FakeEventSource {
    constructor(url) {
      this.url = new URL(url);
      this.listeners = new Map();
      this.closeCount = 0;
      stream = this;
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    emit(name, data) {
      this.listeners.get(name)?.({ data });
    }

    close() {
      this.closeCount++;
    }
  }

  return {
    transport: createTransport({ EventSourceCtor: FakeEventSource, ...options }),
    get stream() { return stream; },
  };
}

test("Firebase transport shallow-lists v2 video IDs and reads the server's ETag", async () => {
  const { transport, requests } = mockRest(
    new Response('{"videoA":true,"videoB":true}'),
    new Response("null"),
    new Response('{"videoId":"video A","revision":3}', { headers: { ETag: '"rev3"' } }),
    new Response("null", { headers: { ETag: '"null_etag"' } }),
    new Response("null"),
  );

  assert.deepEqual(await transport.listVideos(), ["videoA", "videoB"]);
  assert.deepEqual(await transport.listVideos(), []);
  assert.deepEqual(await transport.readVideo("video A"), {
    document: { videoId: "video A", revision: 3 },
    etag: '"rev3"',
  });
  assert.deepEqual(await transport.readVideo("not-found"), { document: null, etag: '"null_etag"' });
  await assert.rejects(transport.readVideo("missing-etag"), { status: 200, message: /ETag/ });

  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url.pathname, `${ROOT}.json`);
  assert.equal(requests[0].url.searchParams.get("shallow"), "true");
  assert.equal(requests[0].url.searchParams.get("auth"), TOKEN);
  assert.equal(requests[2].method, "GET");
  assert.equal(requests[2].url.pathname, `${ROOT}/video%20A.json`);
  assert.equal(new Headers(requests[2].headers).get("X-Firebase-ETag"), "true");
});

test("Firebase transport PUTs conditionally and reports 412 as a conflict", async () => {
  const { transport, requests } = mockRest(
    new Response(null, { status: 204 }),
    new Response(null, { status: 412 }),
    new Response(TOKEN, { status: 403 }),
  );
  const document = { videoId: "videoA", revision: 1, moments: {}, applied: {} };
  await assert.rejects(transport.writeVideo("videoA", document), /ETag/);
  assert.equal(requests.length, 0);
  assert.equal(await transport.writeVideo("videoA", document, '"null_etag"'), true);
  assert.equal(await transport.writeVideo("videoA", document, '"stale"'), false);
  await assert.rejects(transport.writeVideo("videoA", document, '"rev1"'),
    (error) => error.status === 403 && !error.message.includes(TOKEN));

  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url.pathname, `${ROOT}/videoA.json`);
  assert.equal(new Headers(requests[0].headers).get("if-match"), '"null_etag"');
  assert.equal(new Headers(requests[1].headers).get("if-match"), '"stale"');
  assert.deepEqual(JSON.parse(requests[0].body), document);
});

test("Firebase stream emits only invalidations and sanitizes malformed events", async () => {
  const mock = mockStream();
  const changes = [];
  const errors = [];
  let opens = 0;
  const handle = await mock.transport.subscribe({
    onOpen: () => opens++,
    onChange: (videoId) => changes.push(videoId),
    onError: (error) => errors.push(error),
  });
  const { stream } = mock;
  assert.equal(stream.url.pathname, `${ROOT}.json`);
  assert.equal(stream.url.searchParams.get("auth"), TOKEN);
  assert.equal(stream.url.searchParams.has("shallow"), false);
  stream.emit("open");
  stream.emit("put", '{"path":"/","data":null}');
  stream.emit("put", '{"path":"/videoA/moments/m1","data":null}');
  stream.emit("patch", '{"path":"/","data":{"videoA/revision":2,"videoA/moments/m2":null}}');
  stream.emit("patch", '{"path":"/videoB","data":{"moments/m3":null}}');
  stream.emit("patch", '{"path":"/","data":{"videoA/revision":3,"videoB/revision":2}}');
  stream.emit("keep-alive", "null");
  stream.emit("put", `malformed ${TOKEN}`);
  stream.emit("patch", '{"path":"missing-leading-slash","data":{}}');
  stream.onerror({ target: { url: stream.url.href } });

  assert.equal(opens, 1);
  assert.deepEqual(changes, [null, "videoA", "videoA", "videoB", null]);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((error) => error.status === 0 && !error.message.includes(TOKEN)));
  handle.close();
  handle.close();
  stream.emit("put", '{"path":"/videoC","data":null}');
  assert.equal(stream.closeCount, 1);
  assert.equal(changes.length, 5);
});

test("Firebase stream closes once on auth_revoked and cancel", async () => {
  const mock = mockStream();
  const events = [];
  const callbacks = {
    onAuthRevoked: (...args) => events.push(["auth_revoked", ...args]),
    onCancel: (...args) => events.push(["cancel", ...args]),
  };
  const revokedHandle = await mock.transport.subscribe(callbacks);
  const revokedStream = mock.stream;
  revokedStream.emit("auth_revoked", TOKEN);
  revokedStream.emit("cancel", TOKEN);
  revokedHandle.close();
  assert.equal(revokedStream.closeCount, 1);

  await mock.transport.subscribe(callbacks);
  mock.stream.emit("cancel", TOKEN);
  mock.stream.emit("auth_revoked", TOKEN);
  assert.equal(mock.stream.closeCount, 1);
  assert.deepEqual(events, [["auth_revoked"], ["cancel"]]);
});

test("abort closes the Firebase stream and cancels a pending fetch", async () => {
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const mock = mockStream({
    signal: controller.signal,
    fetchFn: (_url, { signal }) => new Promise((_resolve, reject) => {
      assert.equal(signal, controller.signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      markStarted();
    }),
  });
  const handle = await mock.transport.subscribe({});
  const pending = mock.transport.listVideos();
  await started;
  controller.abort(new Error(TOKEN));
  await assert.rejects(pending, (error) => error.name === "AbortError" && !error.message.includes(TOKEN));
  await assert.rejects(mock.transport.subscribe({}), { name: "AbortError" });
  handle.close();
  assert.equal(mock.stream.closeCount, 1);
});

test("Firebase transport redacts token, fetch, and JSON parsing errors", async () => {
  const network = createTransport({
    fetchFn: async (url) => { throw new Error(`Request failed: ${url}`); },
  });
  const auth = createTransport({
    getToken: async () => { throw Object.assign(new Error(TOKEN), { code: TOKEN }); },
  });
  const expired = createTransport({
    getToken: async () => { throw Object.assign(new Error(TOKEN), { code: "TOKEN_EXPIRED" }); },
  });
  const { transport } = mockRest(new Response(TOKEN));
  for (const [client, status, code] of [[network, 0], [auth, 0], [transport, 200], [expired, 0, "TOKEN_EXPIRED"]]) {
    await assert.rejects(client.listVideos(), (error) =>
      error.status === status && error.code === code
      && !error.stack.includes(TOKEN) && !error.stack.includes(encodeURIComponent(TOKEN)));
  }
});
