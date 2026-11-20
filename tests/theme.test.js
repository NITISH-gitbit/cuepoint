const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

const themeSource = readFileSync(require.resolve("../src/moments/theme.js"), "utf8");

function makeHarness({ stored = null, prefersLight = false, throwStorage = false } = {}) {
  const docAttrs = {};
  const listeners = new Map();
  const winListeners = new Map();
  const store = new Map(stored ? [["cuepoint:theme", stored]] : []);

  const makeEl = (tag) => {
    const attrs = {};
    const elListeners = new Map();
    return {
      tag,
      dataset: {},
      children: [],
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren(...items) { this.children = [...items]; },
      addEventListener(evt, fn) { elListeners.set(evt, fn); },
      click() { elListeners.get("click")?.(); },
    };
  };

  const toggleBtn = makeEl("button");
  const documentElement = {
    setAttribute(k, v) { docAttrs[k] = String(v); },
    getAttribute(k) { return docAttrs[k] || null; },
  };

  const localStorage = {
    getItem(k) {
      if (throwStorage) throw new Error("blocked");
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (throwStorage) throw new Error("blocked");
      store.set(k, String(v));
    },
  };

  const YTM = {};
  runInNewContext(themeSource, {
    YTM,
    localStorage,
    document: {
      readyState: "complete",
      documentElement,
      querySelectorAll(sel) { return sel === "[data-theme-toggle]" ? [toggleBtn] : []; },
      createElementNS(_ns, tag) { return makeEl(tag); },
      addEventListener(evt, fn) { listeners.set(evt, fn); },
    },
    window: {
      matchMedia: () => ({
        matches: prefersLight,
        addEventListener() {},
      }),
      addEventListener(evt, fn) {
        if (!winListeners.has(evt)) winListeners.set(evt, []);
        winListeners.get(evt).push(fn);
      },
    },
  });

  return { YTM, documentElement, toggleBtn, store, winListeners };
}

test("theme defaults to dark, honors system light preference, and toggles with persistence", () => {
  const darkDefault = makeHarness();
  assert.equal(darkDefault.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(darkDefault.toggleBtn.getAttribute("aria-label"), "Switch to light mode");
  assert.equal(darkDefault.toggleBtn.getAttribute("aria-pressed"), "false");

  darkDefault.toggleBtn.click();
  assert.equal(darkDefault.documentElement.getAttribute("data-theme"), "light");
  assert.equal(darkDefault.store.get("cuepoint:theme"), "light");
  assert.equal(darkDefault.toggleBtn.getAttribute("aria-label"), "Switch to dark mode");
  assert.equal(darkDefault.toggleBtn.getAttribute("aria-pressed"), "true");

  const systemLight = makeHarness({ prefersLight: true });
  assert.equal(systemLight.documentElement.getAttribute("data-theme"), "light");
  assert.equal(systemLight.toggleBtn.getAttribute("aria-label"), "Switch to dark mode");
});

test("theme syncs across tabs via storage event and survives blocked localStorage", () => {
  const h = makeHarness({ stored: "dark" });
  for (const fn of h.winListeners.get("storage") || []) {
    fn({ key: "cuepoint:theme", newValue: "light" });
  }
  assert.equal(h.documentElement.getAttribute("data-theme"), "light");
  assert.equal(h.toggleBtn.getAttribute("aria-pressed"), "true");

  const blocked = makeHarness({ throwStorage: true });
  assert.equal(blocked.documentElement.getAttribute("data-theme"), "dark");
  blocked.toggleBtn.click();
  assert.equal(blocked.documentElement.getAttribute("data-theme"), "light");
});
