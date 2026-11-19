const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/shared/schema.js");
const { ACTIONS } = require("../src/shared/messages.js");
const { createMemoryRepo } = require("./memory-repo");
const { createSyncModel } = require("../src/background/sync-model.js");
const { createCoordinator } = require("../src/background/background.js");

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
