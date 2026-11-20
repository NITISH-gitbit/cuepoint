"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SVG_PATH = path.join(ROOT, "icons", "cuepoint.svg");
const OUT_DIR = path.join(ROOT, "targets", "chrome", "icons");
const SIZES = [16, 32, 48, 128];

function findBrowser() {
  const candidates = [
    process.env.CHROME_BIN,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error("Could not locate Chrome/Edge binary. Set CHROME_BIN to rasterize PNG icons.");
}

function readPngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== sig) {
    throw new Error(`Invalid PNG signature in ${filePath}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function main() {
  const browser = findBrowser();
  const svg = fs.readFileSync(SVG_PATH, "utf8");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuepoint-icons-"));
  try {
    for (const size of SIZES) {
      const htmlPath = path.join(tmpDir, `icon-${size}.html`);
      const outPath = path.join(OUT_DIR, `cuepoint-${size}.png`);
      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style>
</head>
<body>${svg}</body>
</html>`;
      fs.writeFileSync(htmlPath, html, "utf8");

      const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;
      execFileSync(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--default-background-color=00000000",
          `--window-size=${size},${size}`,
          `--screenshot=${outPath}`,
          fileUrl,
        ],
        { stdio: "pipe" },
      );

      const dims = readPngSize(outPath);
      if (dims.width !== size || dims.height !== size) {
        throw new Error(`Expected ${size}x${size} for ${outPath}, got ${dims.width}x${dims.height}`);
      }
      console.log(`Generated ${path.relative(ROOT, outPath)} (${dims.width}x${dims.height})`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = { SIZES, readPngSize };
