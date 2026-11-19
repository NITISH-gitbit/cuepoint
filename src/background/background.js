var YTM = YTM || {};

(function () {
  "use strict";

  function createCoordinator({ repo, schema, model, actions, sync }) {
    function scopedKey(state, expectedKey) {
      const key = model.activeKey(state);
      if (expectedKey != null && expectedKey !== key) {
        throw new Error("The active library changed. Return to the original library to finish this action.");
      }
      return key;
    }

    async function getMoments(payload = {}) {
      const state = await repo.read();
      return model.listMoments(model.library(state, scopedKey(state, payload.libraryKey)));
    }

    async function mutate(payload, apply) {
      const result = await repo.commit((state) => apply(state, scopedKey(state, payload?.libraryKey)));
      sync?.changed();
      sync?.wake();
      return result;
    }

    function addMoment(payload) {
      return mutate(payload, (state, key) => {
        if (!model.safeKey(payload?.videoId) || !Number.isFinite(Number(payload.timestamp))) {
          throw new Error("A valid YouTube video ID and timestamp are required.");
        }
        const candidate = schema.createMoment(payload);
        const video = model.listMoments(model.library(state, key)).filter((m) => m.videoId === candidate.videoId);
        const spot = video.find((m) => m.timestamp === candidate.timestamp);
        if (spot) return { ...spot, alreadySaved: true };
        if (video.length >= model.limit) throw new Error(`Maximum of ${model.limit} saved moments reached for this video.`);
        return model.change(state, key, "add", candidate);
      });
    }

    function updateMoment(payload) {
      return mutate(payload, (state, key) => {
        const replica = model.library(state, key);
        const { id, note, baseVersion } = payload || {};
        const current = model.listMoments(replica).find((m) => m.id === id);
        const savedNote = typeof note === "string" ? note.trim() : "";
        if (!current || (baseVersion && current.version !== baseVersion)) {
          const original = current || schema.normalizeMoment(payload?.baseMoment);
          if (key === model.LOCAL || !original || !model.safeKey(original.videoId) || original.id !== id || !baseVersion) {
            throw new Error("This moment changed while you were editing. Your draft was not saved.");
          }
          replica.conflicts.push({ id: schema.newId(), kind: "edit", reason: current ? "changed" : "deleted",
            moment: { ...original, note: savedNote } });
          state.version++;
          return { pendingConflict: true };
        }
        if (savedNote === current.note) return current;
        return model.change(state, key, "edit", { ...current, note: savedNote, updatedAt: Date.now() }, current.version);
      });
    }

    function deleteMoment(payload) {
      return mutate(payload, (state, key) => {
        const { id, baseVersion } = payload || {};
        if (!model.safeKey(id)) throw new Error("Moment ID is required.");
        const current = model.listMoments(model.library(state, key)).find((m) => m.id === id);
        if (!current) return { deleted: 0 };
        if (baseVersion && baseVersion !== current.version) throw new Error("This moment changed. Review it before deleting.");
        model.change(state, key, "delete", current, current.version);
        return { deleted: 1 };
      });
    }

    function importInto(state, key, items) {
      const existing = model.listMoments(model.library(state, key));
      const ids = new Set(existing.map((m) => m.id));
      const spots = new Set(existing.map((m) => `${m.videoId}:${m.timestamp}`));
      const counts = new Map();
      for (const m of existing) counts.set(m.videoId, (counts.get(m.videoId) || 0) + 1);
      let added = 0, duplicates = 0, invalid = 0, limitSkipped = 0;
      for (const raw of items) {
        const moment = schema.normalizeMoment(raw);
        if (!moment || !schema.isActiveMoment(moment) || !model.safeKey(moment.videoId)) {
          invalid++;
          continue;
        }
        const spot = `${moment.videoId}:${moment.timestamp}`;
        if (ids.has(moment.id) || spots.has(spot)) {
          duplicates++;
          continue;
        }
        const count = counts.get(moment.videoId) || 0;
        if (count >= model.limit) {
          limitSkipped++;
          continue;
        }
        ids.add(moment.id);
        spots.add(spot);
        counts.set(moment.videoId, count + 1);
        model.change(state, key, "add", { ...moment, id: schema.newId(), url: schema.buildWatchUrl(moment.videoId, moment.timestamp) });
        added++;
      }
      return { added, duplicates, invalid, limitSkipped, total: existing.length + added };
    }

    function importMoments(payload) {
      return mutate(payload, (state, key) => importInto(state, key, Array.isArray(payload?.items) ? payload.items : []));
    }

    async function importLocal(payload) {
      const importResult = await mutate(payload, (state, key) => {
        if (key === model.LOCAL) throw new Error("Connect to a Firebase account first.");
        return importInto(state, key, model.listMoments(model.library(state, model.LOCAL)));
      });
      return { ...await sync.getStatus(), importResult };
    }

    async function resolveConflict(payload) {
      await mutate(payload, (state, key) => {
        const replica = model.library(state, key);
        const index = replica.conflicts.findIndex((conflict) => conflict.id === payload?.id);
        if (index < 0) throw new Error("This conflict is no longer in the active library.");
        const conflict = replica.conflicts[index];
        const { moment, kind } = conflict;
        if (payload.resolution === "retry") {
          const visible = model.listMoments(replica);
          if (kind === "add") {
            const video = visible.filter((m) => m.videoId === moment.videoId);
            if (video.some((m) => m.timestamp === moment.timestamp)) throw new Error("This timestamp is already saved. Copy the note or edit the existing moment.");
            if (video.length >= model.limit) throw new Error("Free a slot on this video before retrying.");
            model.change(state, key, "add", { ...moment, id: schema.newId(), updatedAt: Date.now() });
          } else if (kind === "edit") {
            const current = visible.find((m) => m.id === moment.id);
            if (!current) throw new Error("This moment was deleted. Copy the note to save it elsewhere.");
            model.change(state, key, "edit", { ...current, note: moment.note, updatedAt: Date.now() }, current.version);
          } else {
            throw new Error("Review the current moment before deleting it again.");
          }
        }
        replica.conflicts.splice(index, 1);
        state.version++;
      });
      return sync.getStatus();
    }

    const handlers = {
      [actions.GET_MOMENTS]: getMoments,
      [actions.ADD_MOMENT]: addMoment,
      [actions.UPDATE_MOMENT]: updateMoment,
      [actions.DELETE_MOMENT]: deleteMoment,
      [actions.IMPORT_MOMENTS]: importMoments,
      [actions.GET_SYNC_STATUS]: () => sync.getStatus(),
      [actions.GET_ACTIVE_LIBRARY]: async () => ({ libraryKey: model.activeKey(await repo.read()) }),
      [actions.CLOUD_SIGN_IN]: (p) => sync.connectWithCredentials({ ...p, isSignUp: false }),
      [actions.CLOUD_SIGN_UP]: (p) => sync.connectWithCredentials({ ...p, isSignUp: true }),
      [actions.CLOUD_SIGN_OUT]: () => sync.signOut(),
      [actions.CLOUD_SET_MODE]: (p) => sync.setMode(p?.mode),
      [actions.CLOUD_SYNC_NOW]: () => sync.syncNow(),
      [actions.CLOUD_IMPORT_LOCAL]: importLocal,
      [actions.RESOLVE_SYNC_CONFLICT]: resolveConflict,
    };

    async function handleMessage(message) {
      if (!Object.hasOwn(handlers, message.type)) return undefined;
      return { ok: true, data: await handlers[message.type](message.payload || {}) };
    }

    return { getMoments, addMoment, updateMoment, deleteMoment, importMoments, handleMessage };
  }

  const ext = YTM.messages?.getExtApi();
  if (ext) {
    const model = YTM.syncModel.createSyncModel(YTM.schema);
    const repo = YTM.storage.createLocalRepo(indexedDB, model.initialState);
    const consent = YTM.cloudConsent.createCloudConsent(ext);
    const sync = YTM.syncManager.createSyncManager({
      repo, model, auth: YTM.firebaseAuth, createTransport: YTM.firebaseRtdb.createFirebaseTransport,
      checkConsent: consent.isGranted,
      onStatusChange: ({ conflicts, ...status }, momentsRevision) => ext.storage.local.set({
        syncStatus: { ...status, conflictCount: conflicts.length }, momentsRevision,
      }),
    });
    const coordinator = createCoordinator({ repo, schema: YTM.schema, model, actions: YTM.messages.ACTIONS, sync });

    ext.permissions.onRemoved.addListener((removed) => {
      if (consent.affectsCloud(removed)) sync.pauseForConsent().catch(() => {});
    });

    const { CLOUD_SIGN_IN, CLOUD_SIGN_UP, CLOUD_SIGN_OUT, CLOUD_SET_MODE, CLOUD_SYNC_NOW } = YTM.messages.ACTIONS;
    const managerActions = new Set([CLOUD_SIGN_IN, CLOUD_SIGN_UP, CLOUD_SIGN_OUT, CLOUD_SET_MODE, CLOUD_SYNC_NOW]);
    ext.action.onClicked.addListener(() => ext.tabs.create({ url: ext.runtime.getURL("src/moments/moments.html") }));
    ext.runtime.onMessage.addListener((message) => {
      if (typeof message?.type !== "string" || !message.type.startsWith("ytm:")) return false;
      const dispatch = () => coordinator.handleMessage(message);
      // Capture cloud user intents before waiting so revocation can cancel them.
      // Library commands wait until the local/cloud library switch is durable.
      const result = managerActions.has(message.type) ? dispatch() : sync.ready().then(dispatch);
      return result.catch((error) => ({ ok: false, error: error.message || "Unknown error." }));
    });

    ext.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "cuepoint-sync") sync.recover().catch(() => {});
    });
    ext.alarms.get("cuepoint-sync").then((alarm) => {
      if (!alarm) ext.alarms.create("cuepoint-sync", { periodInMinutes: 1 });
    }).catch(() => {});
    sync.start().catch(() => {});
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { createCoordinator };
})();
