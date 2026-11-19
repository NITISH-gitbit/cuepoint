var YTM = YTM || {};

(function () {
  "use strict";

  function createLocalRepo(indexedDB, initialState) {
    let opening;

    function open() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const request = indexedDB.open("cuepoint-replica", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("replica");
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
              db.close();
              opening = null;
            };
            resolve(db);
          };
          request.onerror = () => reject(request.error);
        }).catch((error) => {
          opening = null;
          throw error;
        });
      }
      return opening;
    }

    async function transact(mutator) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = mutator
          ? db.transaction("replica", "readwrite", { durability: "strict" })
          : db.transaction("replica", "readonly");
        const store = tx.objectStore("replica");
        const request = store.get("state");
        let result;
        let failure;
        request.onsuccess = () => {
          try {
            const state = request.result || initialState();
            result = mutator ? mutator(state) : state;
            if (mutator) store.put(state, "state");
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error("Local database transaction aborted."));
      });
    }

    return { read: () => transact(), commit: transact };
  }

  YTM.storage = { createLocalRepo };
  if (typeof module !== "undefined" && module.exports) module.exports = YTM.storage;
})();
