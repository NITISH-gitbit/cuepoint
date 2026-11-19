const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../src/moments/state.js");

test("filterAndSort filters by note, title, and channelName newest-first", () => {
  const moments = [
    { id: "1", note: "intro", title: "Alpha", channelName: "ChA", savedAt: 100 },
    { id: "2", note: "", title: "Beta", channelName: "Fireship", savedAt: 300 },
    { id: "3", note: "benchmark", title: "Gamma", channelName: "ChC", savedAt: 200 },
  ];

  const all = state.filterAndSort(moments, "");
  assert.deepEqual(
    all.map((m) => m.id),
    ["2", "3", "1"],
  );

  const byChannel = state.filterAndSort(moments, "fireship");
  assert.deepEqual(
    byChannel.map((m) => m.id),
    ["2"],
  );
});

test("groupByVideo groups moments into one card per video sorted chronologically inside", () => {
  const moments = [
    { id: "a", videoId: "v1", timestamp: 120, title: "Video 1", savedAt: 100 },
    { id: "b", videoId: "v2", timestamp: 45, title: "Video 2", savedAt: 250 },
    { id: "c", videoId: "v1", timestamp: 30, title: "Video 1", savedAt: 400 },
  ];

  const groups = state.groupByVideo(moments);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].videoId, "v1");
  assert.deepEqual(
    groups[0].moments.map((m) => m.timestamp),
    [30, 120],
  );
  assert.equal(groups[1].videoId, "v2");
});

test("paginate clamps page numbers and slices accurately", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  const p = state.paginate(items, 99, 10);
  assert.equal(p.totalPages, 3);
  assert.equal(p.currentPage, 3);
  assert.deepEqual(p.pageItems, [21, 22, 23, 24, 25]);
});

test("pageWindow inserts ellipses for large page counts", () => {
  assert.deepEqual(state.pageWindow(5, 10), [1, "…", 4, 5, 6, "…", 10]);
  assert.deepEqual(state.pageWindow(2, 5), [1, 2, 3, 4, 5]);
});
