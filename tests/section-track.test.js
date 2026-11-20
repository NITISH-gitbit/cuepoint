const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

const sectionTrack = require("../src/moments/section-track");
const trackSource = readFileSync(require.resolve("../src/moments/section-track.js"), "utf8");

test("computeActiveSectionId highlights sections as they enter the upper reading zone and activates the final visible section at bottom", () => {
  const sectionsAtScroll = (y) => [
    { id: "s1", top: 320 - y },
    { id: "s2", top: 760 - y },
    { id: "s3", top: 1260 - y },
    { id: "s4", top: 1850 - y },
  ];

  // Top of page -> first section active
  assert.equal(
    sectionTrack.computeActiveSectionId({
      sections: sectionsAtScroll(0),
      scrollY: 0,
      viewportHeight: 900,
      scrollHeight: 2200,
      trackBottom: 100,
    }),
    "s1",
  );

  // Scrolled so s2 is comfortably in upper reading area (~260px from top) -> s2 auto-highlights
  assert.equal(
    sectionTrack.computeActiveSectionId({
      sections: sectionsAtScroll(500),
      scrollY: 500,
      viewportHeight: 900,
      scrollHeight: 2200,
      trackBottom: 100,
    }),
    "s2",
  );

  // Scrolling back up -> returns smoothly to s1
  assert.equal(
    sectionTrack.computeActiveSectionId({
      sections: sectionsAtScroll(180),
      scrollY: 180,
      viewportHeight: 900,
      scrollHeight: 2200,
      trackBottom: 100,
    }),
    "s1",
  );

  // At bottom of page on a tall viewport where s4 top is still ~550px -> s4 still activates
  assert.equal(
    sectionTrack.computeActiveSectionId({
      sections: sectionsAtScroll(1300),
      scrollY: 1300,
      viewportHeight: 900,
      scrollHeight: 2200,
      trackBottom: 100,
    }),
    "s4",
  );
});

test("initSectionTrack updates active links on scroll, locks clicked tab during smooth scroll, and reveals overflowing mobile track horizontally", () => {
  let scrollY = 0;
  const scrollHeight = 2600;
  const viewportHeight = 900;
  const tops = { s1: 300, s2: 750, s3: 1250, s4: 1800 };

  const listeners = new Map();
  const trackCalls = [];

  function makeLink(href, offsetLeft, offsetWidth) {
    const classes = new Set();
    const attrs = {};
    const linkListeners = new Map();
    return {
      offsetLeft,
      offsetWidth,
      classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      getAttribute(k) { return k === "href" ? href : attrs[k]; },
      setAttribute(k, v) { attrs[k] = String(v); },
      removeAttribute(k) { delete attrs[k]; },
      addEventListener(evt, fn) { linkListeners.set(evt, fn); },
      click() { linkListeners.get("click")?.(); },
    };
  }

  const links = [
    makeLink("#s1", 0, 110),
    makeLink("#s2", 110, 120),
    makeLink("#s3", 230, 130),
    makeLink("#s4", 360, 110),
  ];

  const track = {
    scrollWidth: 470,
    clientWidth: 360,
    scrollLeft: 0,
    getBoundingClientRect() { return { bottom: 100 }; },
    scrollTo(opts) {
      trackCalls.push(opts);
      track.scrollLeft = opts.left;
    },
  };

  const sections = Object.fromEntries(
    Object.keys(tops).map((id) => [
      id,
      { getBoundingClientRect: () => ({ top: tops[id] - scrollY }) },
    ]),
  );

  const rafQueue = [];
  const YTM = {};
  runInNewContext(trackSource, {
    YTM,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    document: {
      documentElement: { clientHeight: viewportHeight, scrollHeight },
      querySelector(sel) { return sel === ".track" || sel === ".track-wrap" ? track : null; },
      querySelectorAll(sel) { return sel === ".track__link" ? links : []; },
      getElementById(id) { return sections[id] || null; },
    },
    window: {
      get scrollY() { return scrollY; },
      innerHeight: viewportHeight,
      matchMedia: () => ({ matches: false }),
      addEventListener(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
    },
  });

  YTM.sectionTrack.initSectionTrack({
    trackSelector: ".track",
    trackWrapSelector: ".track-wrap",
    linkSelector: ".track__link",
    currentAttr: "step",
  });

  assert.equal(links[0].classList.contains("is-active"), true);
  assert.equal(links[0].getAttribute("aria-current"), "step");

  // Scroll down into s3 and verify horizontal track scroll-into-view
  scrollY = 1000;
  for (const fn of listeners.get("scroll") || []) fn();
  rafQueue.shift()();
  assert.equal(links[2].classList.contains("is-active"), true);
  assert.equal(links[0].classList.contains("is-active"), false);
  assert.ok(trackCalls.length >= 1, "scrolled narrow horizontal track to keep active item visible");

  // Click s1 while at bottom -> stays locked on s1 during intermediate smooth-scroll ticks
  links[0].click();
  assert.equal(links[0].classList.contains("is-active"), true);
  scrollY = 600;
  for (const fn of listeners.get("scroll") || []) fn();
  rafQueue.shift()();
  assert.equal(links[0].classList.contains("is-active"), true, "stays locked on clicked section during smooth scroll");

  // Finish scroll at s1 -> unlocks cleanly
  scrollY = 0;
  for (const fn of listeners.get("scroll") || []) fn();
  rafQueue.shift()();
  assert.equal(links[0].classList.contains("is-active"), true);
});
