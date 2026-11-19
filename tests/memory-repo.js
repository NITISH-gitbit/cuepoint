const { createWriteQueue } = require('../src/background/queue');

function createMemoryRepo(initial) {
  let state = structuredClone(initial);
  const queue = createWriteQueue();
  return {
    read: () => queue.enqueue(() => structuredClone(state)),
    commit: (mutator) => queue.enqueue(() => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    }),
  };
}

module.exports = { createMemoryRepo };
