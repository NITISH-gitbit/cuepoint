"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const TARGETS = ["firefox", "chrome"];
const PLATFORM_HTML_FILES = [
  "src/moments/firebase-guide.html",
  "src/moments/privacy.html",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseImportScripts(swSource) {
  const match = swSource.match(/importScripts\s*\(([\s\S]*?)\)/);
  if (!match) throw new Error("targets/chrome/sw.js is missing importScripts(...)");
  const scripts = [];
  for (const m of match[1].matchAll(/["']([^"']+)["']/g)) {
    scripts.push(m[1].replace(/^\/+/, ""));
  }
  return scripts;
}

function validateSharedInvariants() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const rootManifest = readJson(path.join(ROOT, "manifest.json"));
  const firefoxManifest = readJson(path.join(ROOT, "targets", "firefox", "manifest.json"));
  const chromeManifest = readJson(path.join(ROOT, "targets", "chrome", "manifest.json"));

  if (JSON.stringify(rootManifest) !== JSON.stringify(firefoxManifest)) {
    throw new Error("Root manifest.json and targets/firefox/manifest.json have drifted out of sync.");
  }
  if (firefoxManifest.version !== pkg.version || chromeManifest.version !== pkg.version) {
    throw new Error(
      `Version mismatch: package.json=${pkg.version}, firefox=${firefoxManifest.version}, chrome=${chromeManifest.version}`,
    );
  }
  if (chromeManifest.browser_specific_settings) {
    throw new Error("targets/chrome/manifest.json must not contain browser_specific_settings.");
  }
  if (chromeManifest.action?.default_area) {
    throw new Error("targets/chrome/manifest.json must not contain Firefox-only action.default_area.");
  }
  if (chromeManifest.background?.scripts) {
    throw new Error("targets/chrome/manifest.json must use background.service_worker, not background.scripts.");
  }

  const allChromeIcons = [
    ...Object.values(chromeManifest.icons || {}),
    ...(typeof chromeManifest.action?.default_icon === "string"
      ? [chromeManifest.action.default_icon]
      : Object.values(chromeManifest.action?.default_icon || {})),
  ];
  for (const iconPath of allChromeIcons) {
    if (iconPath.endsWith(".svg")) {
      throw new Error(`targets/chrome/manifest.json cannot reference SVG icon: ${iconPath}`);
    }
  }

  const swSource = fs.readFileSync(path.join(ROOT, "targets", "chrome", "sw.js"), "utf8");
  const swScripts = parseImportScripts(swSource);
  const ffScripts = firefoxManifest.background?.scripts || [];
  if (JSON.stringify(swScripts) !== JSON.stringify(ffScripts)) {
    throw new Error(
      `Background script load-order mismatch between targets/firefox/manifest.json and targets/chrome/sw.js.\n` +
      `Firefox: ${JSON.stringify(ffScripts)}\nChrome:  ${JSON.stringify(swScripts)}`,
    );
  }

  return { pkg, firefoxManifest, chromeManifest, swScripts };
}

function transformPlatformHtml(html, copyMap, filePath) {
  const re = /<(span|code)(\s+[^>]*?)?\s+data-platform-text="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g;
  return html.replace(re, (_full, tag, before = "", key, after = "") => {
    if (!copyMap) {
      return `<${tag}${before}${after}>${_full.match(/>([\s\S]*?)<\/(?:span|code)>$/)[1]}</${tag}>`;
    }
    if (!Object.hasOwn(copyMap, key)) {
      throw new Error(`Missing platform copy key "${key}" for ${filePath}`);
    }
    return `<${tag}${before}${after}>${escapeHtml(copyMap[key])}</${tag}>`;
  });
}

function verifyBuiltTarget(target, outDir, manifest) {
  const requiredFiles = new Set([
    "manifest.json",
    "LICENSE",
    "THIRD_PARTY_NOTICES",
    ...Object.values(manifest.icons || {}),
    ...(typeof manifest.action?.default_icon === "string"
      ? [manifest.action.default_icon]
      : Object.values(manifest.action?.default_icon || {})),
    ...(manifest.background?.scripts || []),
    ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ]);

  if (target === "chrome") {
    const swScripts = parseImportScripts(fs.readFileSync(path.join(outDir, "sw.js"), "utf8"));
    for (const s of swScripts) requiredFiles.add(s);
  }

  for (const rel of requiredFiles) {
    const abs = path.join(outDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Built ${target} bundle is missing referenced file: ${rel}`);
    }
  }

  const forbidden = target === "chrome" ? /\b(Firefox|Add-ons)\b/i : /\b(Chrome|Chrome Web Store)\b/i;
  const checkFiles = [...PLATFORM_HTML_FILES, "src/shared/platform.js"];
  for (const rel of checkFiles) {
    const content = fs.readFileSync(path.join(outDir, rel), "utf8");
    const hit = content.match(forbidden);
    if (hit) {
      throw new Error(`Unexpected "${hit[0]}" copy found in dist/${target}/${rel}`);
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(rootDir, currentDir = rootDir, out = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(rootDir, abs, out);
    } else if (entry.isFile()) {
      // ZIP spec (APPNOTE 4.4.17.1) and Firefox nsJAR require forward slashes.
      const relPosix = path.relative(rootDir, abs).split(path.sep).join("/");
      out.push({ abs, relPosix });
    }
  }
  return out.sort((a, b) => a.relPosix.localeCompare(b.relPosix));
}

function createZip(sourceDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { abs, relPosix } of files) {
    const nameBuf = Buffer.from(relPosix, "utf8");
    const raw = fs.readFileSync(abs);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const data = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5421, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5421, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(zipPath, Buffer.concat([...localParts, ...centralParts, eocd]));
}

function listZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const entries = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    entries.push(name);
    i += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

function buildTarget(target, { zip = false } = {}) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown build target "${target}". Expected one of: ${TARGETS.join(", ")}`);
  }

  const { pkg } = validateSharedInvariants();
  const targetDir = path.join(ROOT, "targets", target);
  const outDir = path.join(DIST_ROOT, target);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Copy shared core runtime and legal files.
  fs.cpSync(path.join(ROOT, "src"), path.join(outDir, "src"), { recursive: true });
  fs.cpSync(path.join(ROOT, "icons"), path.join(outDir, "icons"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(outDir, "LICENSE"));
  fs.copyFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES"), path.join(outDir, "THIRD_PARTY_NOTICES"));

  // Overlay target manifest and target-specific files.
  const manifestPath = path.join(targetDir, "manifest.json");
  fs.copyFileSync(manifestPath, path.join(outDir, "manifest.json"));
  const manifest = readJson(manifestPath);

  if (target === "chrome") {
    fs.copyFileSync(path.join(targetDir, "sw.js"), path.join(outDir, "sw.js"));
    fs.copyFileSync(path.join(targetDir, "platform.js"), path.join(outDir, "src", "shared", "platform.js"));
    fs.cpSync(path.join(targetDir, "icons"), path.join(outDir, "icons"), { recursive: true });
  }

  // Transform or strip data-platform-text markers in companion HTML docs.
  const copyMapPath = path.join(targetDir, "html-copy.json");
  const copyMap = fs.existsSync(copyMapPath) ? readJson(copyMapPath) : null;
  for (const rel of PLATFORM_HTML_FILES) {
    const abs = path.join(outDir, rel);
    const updated = transformPlatformHtml(fs.readFileSync(abs, "utf8"), copyMap, rel);
    fs.writeFileSync(abs, updated, "utf8");
  }

  verifyBuiltTarget(target, outDir, manifest);

  let zipPath = null;
  if (zip) {
    zipPath = path.join(DIST_ROOT, `cuepoint-${target}-${pkg.version}.zip`);
    createZip(outDir, zipPath);
  }

  return { target, outDir, zipPath, version: pkg.version };
}

function main(argv = process.argv.slice(2)) {
  let targetArg = "all";
  let zip = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target" && argv[i + 1]) {
      targetArg = argv[++i];
    } else if (argv[i] === "--zip") {
      zip = true;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  const selected = targetArg === "all" ? TARGETS : [targetArg];
  for (const target of selected) {
    const result = buildTarget(target, { zip });
    const relOut = path.relative(ROOT, result.outDir);
    const zipSuffix = result.zipPath ? ` (+ ${path.relative(ROOT, result.zipPath)})` : "";
    console.log(`Built ${target} v${result.version} -> ${relOut}${zipSuffix}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  TARGETS,
  PLATFORM_HTML_FILES,
  parseImportScripts,
  validateSharedInvariants,
  buildTarget,
  listZipEntries,
};
