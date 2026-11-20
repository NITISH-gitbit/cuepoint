const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocalRepo } = require("../src/storage/local-repo");

function createFakeIndexedDb() {
  let stored = undefined;
  let openCount = 0;
  const opened = [];

  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        openCount++;
        let closed = false;
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          close() { closed = true; },
          simulateUnexpectedClose() {
            closed = true;
            this.onclose?.();
          },
          simulateSilentClose() {
            closed = true;
          },
          transaction(_name, mode) {
            if (closed) {
              throw new DOMException("The database connection is closing.", "InvalidStateError");
            }
            const tx = {};
            const store = {
              get() {
                const getReq = {};
                queueMicrotask(() => {
                  getReq.result = stored === undefined ? undefined : structuredClone(stored);
                  getReq.onsuccess?.();
                  if (!tx._aborted) {
                    queueMicrotask(() => tx.oncomplete?.());
                  }
                });
                return getReq;
              },
              put(value) {
                if (mode !== "readwrite") throw new Error("readonly");
                stored = structuredClone(value);
              },
            };
            tx.objectStore = () => store;
            tx.abort = () => {
              tx._aborted = true;
              queueMicrotask(() => tx.onabort?.());
            };
            return tx;
          },
        };
        opened.push(db);
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };

  return { indexedDB, opened, openCount: () => openCount };
}

test("local repo reopens cleanly after unexpected IndexedDB onclose", async () => {
  const fake = createFakeIndexedDb();
  const repo = createLocalRepo(fake.indexedDB, () => ({ count: 0 }));

  await repo.commit((state) => { state.count = 1; });
  assert.equal((await repo.read()).count, 1);
  assert.equal(fake.openCount(), 1);

  fake.opened[0].simulateUnexpectedClose();

  await repo.commit((state) => { state.count = 2; });
  assert.equal((await repo.read()).count, 2);
  assert.equal(fake.openCount(), 2);
});

test("local repo recovers if db.transaction throws InvalidStateError before onclose", async () => {
  const fake = createFakeIndexedDb();
  const repo = createLocalRepo(fake.indexedDB, () => ({ count: 0 }));

  await repo.commit((state) => { state.count = 5; });
  fake.opened[0].simulateSilentClose();

  assert.equal((await repo.read()).count, 5);
  assert.equal(fake.openCount(), 2);
});
