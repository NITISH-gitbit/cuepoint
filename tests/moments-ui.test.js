const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

const manifest = require("../manifest.json");
const schema = require("../src/shared/schema");
const firebaseAuth = require("../src/storage/firebase-auth");
const { ACTIONS } = require("../src/shared/messages");
const { createCloudConsent } = require("../src/shared/cloud-consent");
const momentsState = require("../src/moments/state");
const cloudUiSource = readFileSync(require.resolve("../src/moments/cloud-ui.js"), "utf8");
const momentsSource = readFileSync(require.resolve("../src/moments/moments.js"), "utf8");

function makeEl(id = "") {
  const classes = new Set();
  const attrs = {};
  const listeners = new Map();
  const node = {
    id,
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    dataset: {},
    style: {},
    offsetHeight: 130,
    children: [],
    classList: {
      add(n) { classes.add(n); },
      remove(n) { classes.delete(n); },
      toggle(n, force) {
        const on = force === undefined ? !classes.has(n) : !!force;
        if (on) classes.add(n); else classes.delete(n);
        return on;
      },
      contains(n) { return classes.has(n); },
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k]; },
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    dispatch(evt, event = {}) {
      for (const fn of listeners.get(evt) || []) fn({ target: node, currentTarget: node, ...event });
    },
    append(...items) { node.children.push(...items); },
    appendChild(item) { node.children.push(item); return item; },
    before() {},
    replaceChildren(...items) { node.children = [...items]; },
    contains(other) { return other === node || node.children.includes(other); },
    closest(sel) {
      if (sel === "button[data-action]" && node.dataset.action) return node;
      if (sel === ".ts-pill" && node.dataset.momentId) return node;
      return null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 260, right: 290, top: 80, bottom: 110 }; },
    focus() {},
    click() { node.dispatch("click"); },
  };
  return node;
}

test("Cloud setup pane stays open across background MV3 restart broadcasts", async () => {
  const ids = [
    "cloudBtn", "cloudDot", "cloudBtnLabel", "cloudPopover",
    "cloudModeLocal", "cloudModeCloud", "cloudLocalPane", "cloudLocalResumeHint",
    "cloudSetupPane", "cloudConnectedPane", "cloudSnippet", "cloudConfigStatus",
    "cloudDbUrlFallbackWrap", "cloudDbUrl", "cloudEmail", "cloudPassword",
    "cloudSignIn", "cloudGuideBtn", "cloudConnEmail", "cloudConnDb",
    "cloudConnState", "cloudSyncNow", "cloudSyncMsg", "cloudSignOut",
    "cloudPausedSignOut", "cloudImportLocal", "cloudPending",
    "cloudConflicts", "cloudConflictList", "cloudErr",
  ];
  const elements = new Map(ids.map((id) => [id, makeEl(id)]));
  elements.get("cloudPopover").hidden = true;
  elements.get("cloudSetupPane").hidden = true;
  elements.get("cloudConnectedPane").hidden = true;

  let storageListener = null;
  const sent = [];
  const ext = {
    runtime: { getManifest: () => manifest, getURL: (p) => p },
    permissions: { getAll: async () => ({}), contains: async () => false, request: async () => true },
    storage: {
      onChanged: { addListener(fn) { storageListener = fn; } },
    },
  };

  const YTM = {
    schema,
    firebaseAuth,
    cloudConsent: { createCloudConsent },
    momentsRender: { el: (_tag, props = {}) => Object.assign(makeEl(), props) },
    messages: {
      ACTIONS,
      getExtApi: () => ext,
      async sendAction(type, payload) {
        sent.push({ type, payload });
        return { mode: "local", state: "local", hasCredentials: false, libraryKey: "local", pendingCount: 0, conflicts: [] };
      },
    },
  };

  runInNewContext(cloudUiSource, {
    YTM,
    URL,
    document: {
      getElementById: (id) => elements.get(id) || null,
      createDocumentFragment: () => makeEl("frag"),
      addEventListener() {},
      activeElement: null,
    },
    window: { innerWidth: 1024, scrollX: 0, scrollY: 0, confirm: () => true, open() {} },
    setTimeout,
    clearTimeout,
  });

  YTM.cloudUi.initCloudUi(() => {});
  await new Promise(setImmediate);

  assert.equal(elements.get("cloudLocalPane").hidden, false);
  assert.equal(elements.get("cloudSetupPane").hidden, true);

  // User switches to Cloud (BYOC) while signed out -> opens setup pane locally.
  elements.get("cloudModeCloud").click();
  assert.equal(elements.get("cloudLocalPane").hidden, true);
  assert.equal(elements.get("cloudSetupPane").hidden, false);

  // Trigger a setup validation error (e.g. incomplete config).
  elements.get("cloudSignIn").click();
  assert.equal(elements.get("cloudErr").hidden, false);
  const setupErr = elements.get("cloudErr").textContent;

  // Simulate MV3 event page waking on 1-minute alarm and broadcasting mode: "local".
  storageListener({
    syncStatus: {
      newValue: { mode: "local", state: "local", hasCredentials: false, libraryKey: "local", pendingCount: 0, conflictCount: 0 },
    },
  }, "local");

  assert.equal(elements.get("cloudSetupPane").hidden, false, "setup pane remains open after background restart broadcast");
  assert.equal(elements.get("cloudLocalPane").hidden, true);
  assert.equal(elements.get("cloudErr").textContent, setupErr, "setup error message is preserved");

  // Switching back to Local explicitly closes setup pane.
  elements.get("cloudModeLocal").click();
  assert.equal(elements.get("cloudSetupPane").hidden, true);
  assert.equal(elements.get("cloudLocalPane").hidden, false);
});

test("Moments clamps timestamp popover on narrow viewports and surfaces delete conflict errors with refresh", async () => {
  const ids = [
    "list", "pager", "empty", "count", "search", "export", "random",
    "import", "importFile", "status", "pageSize", "version",
    "mobileRandomBtn", "moreBtn", "moreMenu", "moreCount",
    "mobilePageSize", "mobileImportBtn", "mobileExportBtn",
  ];
  const elements = new Map(ids.map((id) => [id, makeEl(id)]));
  let createdPopover = null;
  let pillNode = null;
  let deleteBtn = null;
  let getMomentsCalls = 0;
  let recoverCalls = 0;

  const moment = {
    id: "m1",
    videoId: "vid1",
    url: "https://www.youtube.com/watch?v=vid1&t=10s",
    timestamp: 10,
    title: "Video",
    channelName: "Channel",
    note: "Initial note",
    savedAt: 1000,
    version: "v1",
  };

  let onLibraryChange;
  const ext = {
    runtime: { getManifest: () => manifest },
    storage: {
      local: { get: async () => ({ pageSize: 10 }), set: async () => {} },
      onChanged: { addListener() {} },
    },
  };

  const YTM = {
    schema,
    momentsState,
    cloudUi: { initCloudUi(cb) { onLibraryChange = cb; } },
    momentsRender: {
      el(tag, props = {}) {
        const node = Object.assign(makeEl(props.id || ""), props);
        if (props.id === "tsPopover") createdPopover = node;
        return node;
      },
      renderVideoCard(group) {
        const card = makeEl("li");
        pillNode = makeEl("pill");
        pillNode.dataset.momentId = group.moments[0].id;
        card.append(pillNode);
        return card;
      },
      renderPopoverContent(m) {
        deleteBtn = makeEl("deleteBtn");
        deleteBtn.dataset.action = "delete";
        deleteBtn.dataset.id = m.id;
        return deleteBtn;
      },
      renderPager() {},
    },
    messages: {
      ACTIONS,
      getExtApi: () => ext,
      async sendAction(type) {
        if (type === ACTIONS.GET_MOMENTS) {
          getMomentsCalls++;
          return [moment];
        }
        if (type === ACTIONS.DELETE_MOMENT) {
          throw new Error("This moment changed. Review it before deleting.");
        }
        if (type === ACTIONS.CLOUD_RECOVER) {
          recoverCalls++;
          return {};
        }
        return {};
      },
    },
  };

  elements.get("list").querySelector = (sel) => (sel.includes("m1") ? pillNode : null);
  elements.get("list").querySelectorAll = () => (pillNode ? [pillNode] : []);

  const docListeners = new Map();
  const winListeners = new Map();
  const doc = {
    body: makeEl("body"),
    visibilityState: "visible",
    getElementById: (id) => elements.get(id) || null,
    createDocumentFragment: () => makeEl("frag"),
    addEventListener(evt, fn) {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(fn);
    },
  };

  runInNewContext(momentsSource, {
    YTM,
    CSS: { escape: (s) => s },
    console: { error() {} },
    document: doc,
    window: {
      innerWidth: 300,
      innerHeight: 600,
      scrollX: 0,
      scrollY: 0,
      confirm: () => true,
      scrollTo() {},
      addEventListener(evt, fn) {
        if (!winListeners.has(evt)) winListeners.set(evt, []);
        winListeners.get(evt).push(fn);
      },
    },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  onLibraryChange("firebase:url|uid", true);
  await new Promise(setImmediate);
  assert.equal(getMomentsCalls, 1);

  // Returning to visible Moments tab triggers event-driven cloud recovery (throttled within 5s).
  for (const fn of docListeners.get("visibilitychange") || []) fn();
  for (const fn of winListeners.get("online") || []) fn();
  assert.equal(recoverCalls, 1);

  // Open popover on narrow 300px viewport -> left must clamp to 12px (never negative).
  elements.get("list").dispatch("click", { target: pillNode });
  assert.equal(createdPopover.style.left, "12px");

  // Attempt delete that rejects with concurrency conflict -> displays err.message and refreshes moments.
  createdPopover.dispatch("click", { target: deleteBtn });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(elements.get("status").textContent, "This moment changed. Review it before deleting.");
  assert.equal(elements.get("status").hidden, false);
  assert.equal(getMomentsCalls, 2, "refreshed moments after delete conflict");
});
