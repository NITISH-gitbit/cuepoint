var YTM = YTM || {};

(function () {
  "use strict";

  function createLocalRepo(indexedDB, initialState) {
    let opening = null;
    let currentDb = null;

    function clear(db) {
      if (!db || currentDb === db) {
        currentDb = null;
        opening = null;
      }
    }

    function open() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const request = indexedDB.open("cuepoint-replica", 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains("replica")) {
              request.result.createObjectStore("replica");
            }
          };
          request.onsuccess = () => {
            const db = request.result;
            currentDb = db;
            db.onversionchange = () => {
              clear(db);
              db.close();
            };
            db.onclose = () => clear(db);
            resolve(db);
          };
          request.onerror = () => reject(request.error);
        }).catch((error) => {
          opening = null;
          currentDb = null;
          throw error;
        });
      }
      return opening;
    }

    function openTransaction(db, mutator) {
      return mutator
        ? db.transaction("replica", "readwrite", { durability: "strict" })
        : db.transaction("replica", "readonly");
    }

    async function transact(mutator) {
      let db = await open();
      let tx;
      try {
        tx = openTransaction(db, mutator);
      } catch (error) {
        if (error?.name !== "InvalidStateError") throw error;
        clear(db);
        db = await open();
        tx = openTransaction(db, mutator);
      }
      return new Promise((resolve, reject) => {
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
