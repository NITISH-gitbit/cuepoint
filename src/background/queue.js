var YTM = YTM || {};

(function () {
  "use strict";

  function createWriteQueue() {
    let tail = Promise.resolve();

    function enqueue(task) {
      const next = tail.then(() => task());
      tail = next.catch(() => {});
      return next;
    }

    return { enqueue };
  }

  const api = { createWriteQueue };

  YTM.queue = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
