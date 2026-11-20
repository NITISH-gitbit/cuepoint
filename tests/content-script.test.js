const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

const schema = require("../src/shared/schema");
const mobileDomSource = readFileSync(require.resolve("../src/content/mobile-dom.js"), "utf8");
const domSource = readFileSync(require.resolve("../src/content/dom.js"), "utf8");
const contentSource = readFileSync(require.resolve("../src/content/content.js"), "utf8");

function makeNode(tag, { visible = true, textContent = "", href = "", attrs = {}, children = [], matches = {} } = {}) {
  const classes = new Set();
  const listeners = new Map();
  const node = {
    tagName: tag.toUpperCase(),
    textContent,
    href,
    parentElement: null,
    isConnected: false,
    offsetParent: visible ? {} : null,
    children: [],
    classList: {
      add(...names) { for (const n of names) classes.add(n); },
      remove(...names) { for (const n of names) classes.delete(n); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    dispatch(name, event = {}) {
      for (const fn of listeners.get(name) || []) fn({ currentTarget: node, ...event });
    },
    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = node;
      child.isConnected = node.isConnected;
      node.children.push(child);
      return child;
    },
    append(...items) {
      for (const item of items) node.appendChild(item);
    },
    remove() {
      if (node.parentElement) {
        const siblings = node.parentElement.children;
        const idx = siblings.indexOf(node);
        if (idx >= 0) siblings.splice(idx, 1);
      }
      node.parentElement = null;
      node.isConnected = false;
    },
    closest() { return null; },
    querySelector(sel) { return matches[sel]?.[0] || null; },
    querySelectorAll(sel) { return matches[sel] || []; },
    getClientRects() { return visible ? [{ width: 10, height: 10 }] : []; },
  };
  for (const child of children) node.appendChild(child);
  return node;
}

test("mobile getChannel skips empty-text avatar link and reads channel name link including /c/ and /user/", () => {
  const avatarLink = makeNode("a", { visible: true, textContent: "   ", href: "https://m.youtube.com/@creator" });
  const hiddenLink = makeNode("a", { visible: false, textContent: "Old Channel", href: "https://m.youtube.com/@old" });
  const channelLink = makeNode("a", { visible: true, textContent: "  Creator Name  ", href: "https://m.youtube.com/c/creator" });

  const channelSelector = [
    "ytm-slim-owner-renderer a[href*='/@']",
    "ytm-slim-owner-renderer a[href*='/channel/']",
    "ytm-slim-owner-renderer a[href*='/c/']",
    "ytm-slim-owner-renderer a[href*='/user/']",
    "ytm-video-owner-renderer a[href*='/@']",
    "ytm-video-owner-renderer a[href*='/channel/']",
    "ytm-video-owner-renderer a[href*='/c/']",
    "ytm-video-owner-renderer a[href*='/user/']",
  ].join(", ");

  const watch = makeNode("ytm-watch", {
    visible: true,
    attrs: { "video-id": "vid123" },
    matches: { [channelSelector]: [avatarLink, hiddenLink, channelLink] },
  });

  const YTM = {};
  runInNewContext(mobileDomSource, { YTM });
  const mobile = YTM.createMobileDom({
    document: {
      querySelectorAll(sel) { return sel === "ytm-watch" ? [watch] : []; },
    },
    getVideoId: () => "vid123",
    isVideoControl: (node) => node.offsetParent !== null,
    titleFromDocument: () => "Fallback",
  });

  assert.deepEqual({ ...mobile.getChannel() }, {
    name: "Creator Name",
    url: "https://m.youtube.com/c/creator",
  });
});

test("desktop getTitle and getChannel read from visible ytd-watch-metadata instead of hidden stale nodes", () => {
  const hiddenTitle = makeNode("h1", { visible: false, textContent: "Stale Video" });
  const hiddenChannel = makeNode("a", { visible: false, textContent: "Stale Channel", href: "https://www.youtube.com/@stale" });
  const hiddenMeta = makeNode("ytd-watch-metadata", {
    visible: false,
    matches: {
      "h1 yt-formatted-string, h1": [hiddenTitle],
      "ytd-channel-name a, #channel-name a": [hiddenChannel],
    },
  });

  const visibleTitle = makeNode("h1", { visible: true, textContent: "  Active Video  " });
  const visibleChannel = makeNode("a", { visible: true, textContent: "Active Channel", href: "https://www.youtube.com/@active" });
  const visibleMeta = makeNode("ytd-watch-metadata", {
    visible: true,
    matches: {
      "h1 yt-formatted-string, h1": [visibleTitle],
      "ytd-channel-name a, #channel-name a": [visibleChannel],
    },
  });

  const YTM = {};
  runInNewContext(mobileDomSource, { YTM });
  runInNewContext(domSource, {
    YTM,
    URLSearchParams,
    location: { hostname: "www.youtube.com", pathname: "/watch", search: "?v=active1" },
    document: {
      title: "Fallback - YouTube",
      querySelector(sel) { return sel === "ytd-watch-metadata" ? hiddenMeta : null; },
      querySelectorAll(sel) { return sel === "ytd-watch-metadata" ? [hiddenMeta, visibleMeta] : []; },
    },
  });

  assert.equal(YTM.contentDom.getTitle(), "Active Video");
  assert.deepEqual({ ...YTM.contentDom.getChannel() }, {
    name: "Active Channel",
    url: "https://www.youtube.com/@active",
  });
});

test("overlapping flashButton calls restore Save moment cleanly and SPA navigation without yt-navigate-finish cleans up", async () => {
  const row = makeNode("div", { visible: true });
  row.isConnected = true;

  let popoverClosed = 0;
  let observerCallback = null;
  const rafQueue = [];
  const timeouts = new Map();
  let nextTimerId = 1;
  const windowListeners = new Map();
  const location = { pathname: "/watch", search: "?v=vid1" };
  let addCount = 0;

  let buttonLabel;
  const document = {
    documentElement: {},
    createElementNS(_ns, tag) {
      return makeNode(tag, { visible: true });
    },
    createElement(tag) {
      const node = makeNode(tag, { visible: true });
      if (tag === "span") buttonLabel = node;
      node.querySelector = (sel) => (sel === ".ytm-save-btn__label" ? buttonLabel : null);
      return node;
    },
  };

  const YTM = {
    schema,
    messages: {
      ACTIONS: { GET_ACTIVE_LIBRARY: "lib", ADD_MOMENT: "add" },
      async sendAction(type) {
        if (type === "lib") return { libraryKey: "local" };
        addCount++;
        if (addCount === 1) return {};
        throw new Error("Maximum of 3 saved moments reached for this video.");
      },
    },
    contentDom: {
      onWatchPage: () => location.pathname === "/watch" && location.search.includes("v="),
      getVideoId: () => new URLSearchParams(location.search).get("v") || "",
      getVideoEl: () => ({ currentTime: 12 }),
      getTitle: () => "Video",
      getChannel: () => ({ name: "Ch", url: "https://www.youtube.com/@ch" }),
      findButtonPlacement: () => ({ row, fallback: null }),
    },
    popover: {
      async openNotePopover() { return "note"; },
      showNotice() {},
      closePopover() { popoverClosed++; },
    },
  };

  const sandbox = {
    YTM,
    document,
    location,
    console: { error() {} },
    MutationObserver: class {
      constructor(cb) { observerCallback = cb; }
      observe() {}
    },
    requestAnimationFrame(fn) { rafQueue.push(fn); },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { const id = nextTimerId++; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    window: {
      addEventListener(evt, fn) {
        if (!windowListeners.has(evt)) windowListeners.set(evt, []);
        windowListeners.get(evt).push(fn);
      },
    },
  };

  runInNewContext(contentSource, sandbox);

  const btn = row.children[0];
  assert.ok(btn, "button injected on watch page");
  assert.equal(buttonLabel.textContent, "Save moment");

  // First save flashes "Saved", second overlapping save flashes "Max 3/video" before first timer fires.
  btn.dispatch("click");
  await new Promise(setImmediate);
  assert.equal(buttonLabel.textContent, "Saved");
  assert.equal(btn.classList.contains("ytm-save-btn--done"), true);
  assert.equal(timeouts.size, 1);

  btn.dispatch("click");
  await new Promise(setImmediate);
  assert.equal(buttonLabel.textContent, "Max 3/video");
  assert.equal(btn.classList.contains("ytm-save-btn--done"), false);
  assert.equal(btn.classList.contains("ytm-save-btn--err"), true);
  assert.equal(timeouts.size, 1, "previous flash timer was cancelled");

  // Fire the active flash timer: label must return to "Save moment", never stuck on "Saved".
  for (const fn of [...timeouts.values()]) fn();
  assert.equal(buttonLabel.textContent, "Save moment");
  assert.equal(btn.classList.contains("ytm-save-btn--err"), false);

  // Navigate away without yt-navigate-finish (e.g. m.youtube.com pushState + DOM mutation).
  location.pathname = "/";
  location.search = "";
  observerCallback();
  assert.equal(rafQueue.length, 1);
  rafQueue.shift()();
  assert.equal(row.children.length, 0, "button removed when navigating off watch page without yt-navigate-finish");
  assert.ok(popoverClosed >= 1, "popover closed on route change");

  // Navigate back to watch via state-navigateend (mobile YouTube) and off via popstate.
  location.pathname = "/watch";
  location.search = "?v=vid2";
  for (const fn of windowListeners.get("state-navigateend") || []) fn();
  assert.equal(row.children.length, 1, "button re-injected on state-navigateend");

  location.pathname = "/feed/subscriptions";
  location.search = "";
  for (const fn of windowListeners.get("popstate") || []) fn();
  assert.equal(row.children.length, 0, "button removed on popstate");
});
