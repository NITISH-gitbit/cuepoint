const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildTarget, validateSharedInvariants, parseImportScripts, listZipEntries } = require("../scripts/build");
const { SIZES, readPngSize } = require("../scripts/build-icons");

const ROOT = path.resolve(__dirname, "..");

test("shared manifest and service-worker invariants stay in sync across Firefox and Chrome", () => {
  const { pkg, firefoxManifest, chromeManifest, swScripts } = validateSharedInvariants();
  assert.equal(firefoxManifest.version, pkg.version);
  assert.equal(chromeManifest.version, pkg.version);
  assert.equal(chromeManifest.minimum_chrome_version, "116");
  assert.deepEqual(swScripts, firefoxManifest.background.scripts);
  assert.ok(firefoxManifest.permissions.includes("unlimitedStorage"));
  assert.ok(chromeManifest.permissions.includes("unlimitedStorage"));
});

test("committed Chrome PNG icons have valid PNG headers and exact required dimensions", () => {
  for (const size of SIZES) {
    const iconPath = path.join(ROOT, "targets", "chrome", "icons", `cuepoint-${size}.png`);
    assert.equal(fs.existsSync(iconPath), true, `missing ${iconPath}`);
    assert.deepEqual(readPngSize(iconPath), { width: size, height: size });
  }
});

test("buildTarget produces valid, isolated dist/firefox and dist/chrome bundles", () => {
  const ff = buildTarget("firefox");
  const ch = buildTarget("chrome");

  const ffManifest = JSON.parse(fs.readFileSync(path.join(ff.outDir, "manifest.json"), "utf8"));
  const chManifest = JSON.parse(fs.readFileSync(path.join(ch.outDir, "manifest.json"), "utf8"));

  // Firefox keeps gecko metadata, SVG icons, and background.scripts.
  assert.equal(ffManifest.browser_specific_settings.gecko.id, "cuepoint@local");
  assert.equal(ffManifest.icons["128"], "icons/cuepoint.svg");
  assert.ok(Array.isArray(ffManifest.background.scripts));

  // Chrome omits Firefox-only keys, uses sw.js + PNG icons, and scopes content scripts to desktop YouTube.
  assert.equal(chManifest.browser_specific_settings, undefined);
  assert.equal(chManifest.action.default_area, undefined);
  assert.equal(chManifest.background.service_worker, "sw.js");
  assert.equal(chManifest.background.scripts, undefined);
  assert.equal(chManifest.icons["128"], "icons/cuepoint-128.png");
  assert.deepEqual(chManifest.content_scripts[0].matches, ["https://www.youtube.com/*"]);

  // Built sw.js exists and every imported script exists inside dist/chrome.
  const swSource = fs.readFileSync(path.join(ch.outDir, "sw.js"), "utf8");
  for (const rel of parseImportScripts(swSource)) {
    assert.equal(fs.existsSync(path.join(ch.outDir, rel)), true, `dist/chrome missing ${rel}`);
  }

  // Platform copy substitution leaves zero data-platform-text attributes or cross-browser leaks.
  const chGuide = fs.readFileSync(path.join(ch.outDir, "src/moments/firebase-guide.html"), "utf8");
  const chPrivacy = fs.readFileSync(path.join(ch.outDir, "src/moments/privacy.html"), "utf8");
  const chPlatform = fs.readFileSync(path.join(ch.outDir, "src/shared/platform.js"), "utf8");
  for (const content of [chGuide, chPrivacy, chPlatform]) {
    assert.equal(content.includes("data-platform-text"), false);
    assert.equal(/\b(Firefox|Add-ons)\b/i.test(content), false);
  }
  assert.match(chGuide, /Connect Chrome/);
  assert.match(chPrivacy, /Chrome profile/);
  assert.match(chPrivacy, /Chrome Web Store listing/);

  const ffGuide = fs.readFileSync(path.join(ff.outDir, "src/moments/firebase-guide.html"), "utf8");
  const ffPrivacy = fs.readFileSync(path.join(ff.outDir, "src/moments/privacy.html"), "utf8");
  assert.equal(ffGuide.includes("data-platform-text"), false);
  assert.equal(ffPrivacy.includes("data-platform-text"), false);
  assert.match(ffGuide, /Connect Firefox/);
  assert.match(ffPrivacy, /Firefox profile/);

  // ZIP archives use strictly POSIX forward-slash entry paths so Firefox nsJAR can load them directly.
  const ffZip = buildTarget("firefox", { zip: true });
  const chZip = buildTarget("chrome", { zip: true });
  for (const zipPath of [ffZip.zipPath, chZip.zipPath]) {
    const entries = listZipEntries(zipPath);
    assert.ok(entries.includes("manifest.json"));
    assert.ok(entries.includes("src/background/background.js"));
    assert.equal(entries.some((e) => e.includes("\\")), false, `Backslash path found in ${zipPath}`);
  }
});
