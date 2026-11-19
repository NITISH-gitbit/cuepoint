const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../src/shared/schema.js");

test("sanitizeUrl rejects javascript: and data: schemes", () => {
  assert.equal(schema.sanitizeUrl("javascript:alert(1)", { requireYouTubeHost: true }), "");
  assert.equal(schema.sanitizeUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(schema.sanitizeUrl("https://evil.example/watch?v=123", { requireYouTubeHost: true }), "");
});

test("sanitizeUrl accepts valid YouTube URLs", () => {
  assert.equal(
    schema.sanitizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", {
      requireYouTubeHost: true,
    }),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
  );
  assert.equal(
    schema.sanitizeUrl("https://youtu.be/dQw4w9WgXcQ?t=42", {
      requireYouTubeHost: true,
    }),
    "https://youtu.be/dQw4w9WgXcQ?t=42",
  );
});

test("createMoment builds canonical moment with schemaVersion and timestamps", () => {
  const m = schema.createMoment({
    videoId: "dQw4w9WgXcQ",
    timestamp: 95.8,
    title: "  Test Video  ",
    channelName: " Test Channel ",
    channelUrl: "javascript:alert(1)",
    note: "  great part ",
  });

  assert.equal(m.schemaVersion, schema.SCHEMA_VERSION);
  assert.equal(m.videoId, "dQw4w9WgXcQ");
  assert.equal(m.timestamp, 95);
  assert.equal(m.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s");
  assert.equal(m.title, "Test Video");
  assert.equal(m.channelName, "Test Channel");
  assert.equal(m.channelUrl, "");
  assert.equal(m.note, "great part");
  assert.ok(m.id.length > 0);
  assert.equal(m.savedAt, m.updatedAt);
});

test("normalizeMoment rejects invalid URLs and negative timestamps", () => {
  assert.equal(schema.normalizeMoment(null), null);
  assert.equal(
    schema.normalizeMoment({ url: "javascript:alert(1)", timestamp: 10 }),
    null,
  );
  assert.equal(
    schema.normalizeMoment({ url: "https://www.youtube.com/watch?v=abc", timestamp: -5 }),
    null,
  );
});

test("formatTime formats seconds into M:SS and H:MM:SS", () => {
  assert.equal(schema.formatTime(0), "0:00");
  assert.equal(schema.formatTime(65), "1:05");
  assert.equal(schema.formatTime(3661), "1:01:01");
});
