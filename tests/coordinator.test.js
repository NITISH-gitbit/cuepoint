const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/shared/schema.js");
const { ACTIONS } = require("../src/shared/messages.js");
const { createMemoryRepo } = require("./memory-repo");
const { createSyncModel } = require("../src/background/sync-model.js");
const { createCoordinator, createMessageListener } = require("../src/background/background.js");

function makeCoordinator() {
  const model = createSyncModel(schema);
  const repo = createMemoryRepo(model.initialState());
  return createCoordinator({ repo, model, schema, actions: ACTIONS });
}

test("concurrent addMoment calls do not overwrite each other", async () => {
  const coord = makeCoordinator();
  await Promise.all([
    coord.addMoment({ videoId: "vid1111", timestamp: 10, note: "one" }),
    coord.addMoment({ videoId: "vid2222", timestamp: 20, note: "two" }),
    coord.addMoment({ videoId: "vid3333", timestamp: 30, note: "three" }),
  ]);

  const all = await coord.getMoments();
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((m) => m.note),
    ["one", "two", "three"],
  );
});

test("addMoment preserves the original note on duplicate saves and enforces max 3 per video", async () => {
  const coord = makeCoordinator();
  const first = await coord.addMoment({ videoId: "vid1111", timestamp: 10, note: "first" });
  const duplicate = await coord.addMoment({ videoId: "vid1111", timestamp: 10, note: "updated first" });
  assert.equal(duplicate.alreadySaved, true);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.version, first.version);
  await coord.addMoment({ videoId: "vid1111", timestamp: 20, note: "second" });
  await coord.addMoment({ videoId: "vid1111", timestamp: 30, note: "third" });

  await assert.rejects(
    coord.addMoment({ videoId: "vid1111", timestamp: 40, note: "fourth" }),
    /Maximum of 3 saved moments/,
  );

  const all = await coord.getMoments();
  assert.equal(all.length, 3);
  assert.equal(all.find((m) => m.timestamp === 10).note, "first");
});

test("updateMoment and deleteMoment mutate safely", async () => {
  const coord = makeCoordinator();
  const created = await coord.addMoment({
    videoId: "vid1111",
    timestamp: 15,
    note: "initial",
  });

  const updated = await coord.updateMoment({ id: created.id, note: "edited" });
  assert.equal(updated.note, "edited");
  assert.ok(updated.updatedAt >= created.savedAt);

  const del = await coord.deleteMoment({ id: created.id });
  assert.equal(del.deleted, 1);
  assert.equal((await coord.getMoments()).length, 0);
});

test("importMoments deduplicates by id/(videoId,timestamp), enforces max 3/video, and rejects unsafe URLs", async () => {
  const coord = makeCoordinator();
  const existing = await coord.addMoment({ videoId: "vid1111", timestamp: 5 });

  const summary = await coord.importMoments({
    items: [
      existing,
      { url: "https://www.youtube.com/watch?v=vid1111&t=5s", timestamp: 5 },
      { url: "https://www.youtube.com/watch?v=vid1111&t=15s", timestamp: 15 },
      { url: "https://www.youtube.com/watch?v=vid1111&t=25s", timestamp: 25 },
      { url: "https://www.youtube.com/watch?v=vid1111&t=35s", timestamp: 35 },
      { url: "https://www.youtube.com/watch?v=vid2222&t=50s", timestamp: 50, note: "valid" },
      { url: "javascript:alert(1)", timestamp: 10 },
    ],
  });

  assert.deepEqual(summary, {
    added: 3,
    duplicates: 2,
    invalid: 1,
    limitSkipped: 1,
    total: 4,
  });
});

test("createMessageListener uses callback sendResponse + literal true return for Chrome and Firefox MV3", async () => {
  const coord = makeCoordinator();
  let readyCalls = 0;
  const sync = {
    async ready() { readyCalls++; },
    async setMode(mode) { return { mode }; },
  };
  const managerActions = new Set([ACTIONS.CLOUD_SET_MODE]);
  const listener = createMessageListener({ coordinator: coord, sync, managerActions });

  // Non-ytm messages return false synchronously without calling sendResponse.
  let called = false;
  assert.equal(listener({ type: "other:ping" }, {}, () => { called = true; }), false);
  assert.equal(called, false);

  // Library messages wait for sync.ready(), return literal true (never a Promise), and call sendResponse.
  const libReply = await new Promise((resolve) => {
    const ret = listener({ type: ACTIONS.GET_MOMENTS, payload: {} }, {}, resolve);
    assert.strictEqual(ret, true);
  });
  assert.deepEqual(libReply, { ok: true, data: [] });
  assert.equal(readyCalls, 1);

  // Unknown ytm:* action returns structured error rather than undefined.
  const unknownReply = await new Promise((resolve) => {
    const ret = listener({ type: "ytm:nonexistent" }, {}, resolve);
    assert.strictEqual(ret, true);
  });
  assert.equal(unknownReply.ok, false);
  assert.match(unknownReply.error, /Unknown action/);

  // Manager actions bypass sync.ready() and serialize thrown errors into { ok: false, error }.
  const failCoord = {
    handleMessage() {
      throw new Error("sync failure");
    },
  };
  const failListener = createMessageListener({ coordinator: failCoord, sync, managerActions });
  const errReply = await new Promise((resolve) => {
    const ret = failListener({ type: ACTIONS.CLOUD_SET_MODE, payload: { mode: "cloud" } }, {}, resolve);
    assert.strictEqual(ret, true);
  });
  assert.deepEqual(errReply, { ok: false, error: "sync failure" });
  assert.equal(readyCalls, 2);
});
