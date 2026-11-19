const test = require("node:test");
const assert = require("node:assert/strict");
const { createWriteQueue } = require("../src/background/queue.js");

test("write queue executes async tasks strictly in FIFO order", async () => {
  const queue = createWriteQueue();
  const order = [];

  const p1 = queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 25));
    order.push(1);
    return "first";
  });
  const p2 = queue.enqueue(async () => {
    order.push(2);
    return "second";
  });
  const p3 = queue.enqueue(async () => {
    order.push(3);
    return "third";
  });

  const results = await Promise.all([p1, p2, p3]);
  assert.deepEqual(results, ["first", "second", "third"]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("write queue continues processing after a task throws", async () => {
  const queue = createWriteQueue();

  await assert.rejects(
    queue.enqueue(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  const ok = await queue.enqueue(async () => "recovered");
  assert.equal(ok, "recovered");
});
