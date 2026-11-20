"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildTarget } = require("./build");

const ROOT = path.resolve(__dirname, "..");

function findChromiumBinary() {
  const candidates = [];
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);

  // Prefer Playwright Chromium (always supports --load-extension in headless=new).
  const pwRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"), "ms-playwright");
  if (fs.existsSync(pwRoot)) {
    for (const entry of fs.readdirSync(pwRoot).sort().reverse()) {
      if (!entry.startsWith("chromium-")) continue;
      for (const rel of [
        path.join("chrome-win64", "chrome.exe"),
        path.join("chrome-win", "chrome.exe"),
        path.join("chrome-linux", "chrome"),
        path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      ]) {
        candidates.push(path.join(pwRoot, entry, rel));
      }
    }
  }

  candidates.push(
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  );

  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) return bin;
  }
  throw new Error("Could not locate a Chromium binary for smoke testing. Set CHROME_BIN.");
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", (e) => reject(new Error(`CDP socket error: ${e.message || "failed"}`)), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(`CDP ${msg.error.message} (${msg.error.code})`));
        else entry.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout waiting for ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async evaluate(sessionId, expression) {
    const res = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || "Runtime exception";
      throw new Error(`Eval failed: ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await predicate();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function launchChromium(chromeBin, extDir, userDataDir) {
  const proc = spawn(
    chromeBin,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium failed to expose DevTools port.\n${stderr}`)), 15_000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited early (${code}).\n${stderr}`));
    });
  });

  return { proc, wsUrl };
}

async function openExtensionPage(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params, sid) => {
    if (sid === sessionId) {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "unknown exception");
    }
  });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await waitFor(
    () => cdp.evaluate(sessionId, `location.href === ${JSON.stringify(url)} && document.readyState === "complete"`),
    `load ${url}`,
  );
  // Allow extension UI initialization microtasks/messages to settle.
  await new Promise((r) => setTimeout(r, 350));
  return { targetId, sessionId, exceptions };
}

async function run() {
  const built = buildTarget("chrome");
  const chromeBin = findChromiumBinary();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuepoint-chrome-smoke-"));
  let proc;
  let cdp;

  try {
    console.log(`Launching Chromium smoke test: ${chromeBin}`);
    const launched = await launchChromium(chromeBin, built.outDir, userDataDir);
    proc = launched.proc;
    cdp = new CdpClient(launched.wsUrl);
    await cdp.connect();

    // 1. Discover and attach to the CuePoint MV3 Service Worker.
    const swTarget = await waitFor(async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.find(
        (t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://") && t.url.endsWith("/sw.js"),
      );
    }, "CuePoint service worker target");

    const swUrl = new URL(swTarget.url);
    const extOrigin = `${swUrl.protocol}//${swUrl.host}`;
    console.log(`Service Worker active: ${swTarget.url}`);

    const { sessionId: swSession } = await cdp.send("Target.attachToTarget", {
      targetId: swTarget.targetId,
      flatten: true,
    });
    const swExceptions = [];
    cdp.on("Runtime.exceptionThrown", (params, sid) => {
      if (sid === swSession) swExceptions.push(params.exceptionDetails?.exception?.description || "SW exception");
    });
    await cdp.send("Runtime.enable", {}, swSession);

    // Verify SW globals, platform descriptor, EventSource availability, and 1-min alarm registration.
    const alarmInfo = await waitFor(
      () => cdp.evaluate(swSession, `(async () => await chrome.alarms.get("cuepoint-sync"))()`),
      "cuepoint-sync alarm creation",
      5000,
    );
    const swFacts = await cdp.evaluate(
      swSession,
      `({
        platformId: globalThis.YTM?.platform?.id,
        browserName: globalThis.YTM?.platform?.browserName,
        hasEventSource: typeof EventSource === "function",
        hasAbortAny: typeof AbortSignal?.any === "function",
        hasIndexedDB: typeof indexedDB === "object",
      })`,
    );
    assert.deepEqual(
      { ...swFacts, alarmName: alarmInfo?.name || null, alarmPeriod: alarmInfo?.periodInMinutes || null },
      {
        platformId: "chrome",
        browserName: "Chrome",
        hasEventSource: true,
        hasAbortAny: true,
        hasIndexedDB: true,
        alarmName: "cuepoint-sync",
        alarmPeriod: 1,
      },
    );
    console.log("✔ SW globals, EventSource, IndexedDB, platform=chrome, and cuepoint-sync alarm verified");

    // 1b. Empirically verify EventSource SSE inside the real Chrome MV3 Service Worker via firebase-rtdb.js.
    const sseServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.write('event: put\ndata: {"path":"/videoSmoke1","data":null}\n\n');
      setTimeout(() => {
        res.write('event: patch\ndata: {"path":"/","data":{"videoSmoke2/revision":2}}\n\n');
      }, 40);
      setTimeout(() => {
        res.write("event: auth_revoked\ndata: null\n\n");
        res.end();
      }, 80);
    });
    await new Promise((resolve) => sseServer.listen(0, "127.0.0.1", resolve));
    const ssePort = sseServer.address().port;
    try {
      const sseEvents = await cdp.evaluate(
        swSession,
        `(async () => {
          const transport = YTM.firebaseRtdb.createFirebaseTransport({
            databaseURL: "http://127.0.0.1:${ssePort}",
            uid: "smokeUser",
            getToken: async () => "smoke-token",
          });
          const seen = [];
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("SSE timeout: " + JSON.stringify(seen))), 5000);
            transport.subscribe({
              onOpen: () => seen.push("open"),
              onChange: (videoId) => seen.push("change:" + videoId),
              onAuthRevoked: () => { seen.push("auth_revoked"); clearTimeout(timer); resolve(); },
              onError: (err) => { clearTimeout(timer); reject(err); },
            }).catch((err) => { clearTimeout(timer); reject(err); });
          });
          return seen;
        })()`,
      );
      assert.deepEqual(sseEvents, ["open", "change:videoSmoke1", "change:videoSmoke2", "auth_revoked"]);
      console.log("✔ Real EventSource SSE inside Chrome MV3 Service Worker verified (open, put, patch, auth_revoked)");
    } finally {
      await new Promise((resolve) => sseServer.close(resolve));
    }

    // 2. Open moments.html and exercise real MV3 messaging + IndexedDB CRUD + consent + theme toggle.
    const moments = await openExtensionPage(cdp, `${extOrigin}/src/moments/moments.html`);

    const crudResult = await cdp.evaluate(
      moments.sessionId,
      `(async () => {
        const { ACTIONS, sendAction } = YTM.messages;
        const status = await sendAction(ACTIONS.GET_SYNC_STATUS);
        const added = await sendAction(ACTIONS.ADD_MOMENT, {
          libraryKey: status.libraryKey,
          videoId: "dQw4w9WgXcQ",
          timestamp: 42,
          title: "Chrome Smoke Video",
          channelName: "Test Channel",
          channelUrl: "https://www.youtube.com/@test",
          note: "initial chrome note",
        });
        const listed1 = await sendAction(ACTIONS.GET_MOMENTS, { libraryKey: status.libraryKey });
        const updated = await sendAction(ACTIONS.UPDATE_MOMENT, {
          libraryKey: status.libraryKey,
          id: added.id,
          note: "updated chrome note",
          baseVersion: added.version,
        });
        const listed2 = await sendAction(ACTIONS.GET_MOMENTS, { libraryKey: status.libraryKey });

        const consent = YTM.cloudConsent.createCloudConsent(chrome, YTM.platform);
        const grantedBeforePrompt = await consent.isGranted();
        const affectsOrigin = consent.affectsCloud({ origins: ["https://demo.firebaseio.com/*"] });

        const initialTheme = document.documentElement.getAttribute("data-theme");
        document.getElementById("themeToggle").click();
        const toggledTheme = document.documentElement.getAttribute("data-theme");

        const bodyText = document.body.textContent || "";
        return {
          mode: status.mode,
          libraryKey: status.libraryKey,
          addedId: added.id,
          countAfterAdd: listed1.length,
          updatedNote: updated.note,
          persistedNote: listed2[0]?.note,
          grantedBeforePrompt,
          affectsOrigin,
          initialTheme,
          toggledTheme,
          leaksFirefox: /\\b(Firefox|Add-ons)\\b/i.test(bodyText),
        };
      })()`,
    );

    assert.equal(crudResult.mode, "local");
    assert.equal(crudResult.libraryKey, "local");
    assert.equal(crudResult.countAfterAdd, 1);
    assert.equal(crudResult.updatedNote, "updated chrome note");
    assert.equal(crudResult.persistedNote, "updated chrome note");
    assert.equal(crudResult.grantedBeforePrompt, false);
    assert.equal(crudResult.affectsOrigin, true);
    assert.notEqual(crudResult.initialTheme, crudResult.toggledTheme);
    assert.equal(crudResult.leaksFirefox, false);
    console.log("✔ moments.html sendMessage round-trip, IndexedDB CRUD, Chrome consent check, and theme toggle verified");

    // 3. Simulate Service Worker termination and verify cold-wake + IndexedDB persistence.
    await cdp.send("Target.closeTarget", { targetId: swTarget.targetId }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));

    const afterRestart = await cdp.evaluate(
      moments.sessionId,
      `(async () => {
        const { ACTIONS, sendAction } = YTM.messages;
        const list = await sendAction(ACTIONS.GET_MOMENTS, { libraryKey: "local" });
        const del = await sendAction(ACTIONS.DELETE_MOMENT, { libraryKey: "local", id: list[0].id, baseVersion: list[0].version });
        const afterDel = await sendAction(ACTIONS.GET_MOMENTS, { libraryKey: "local" });
        return { survivedCount: list.length, survivedNote: list[0]?.note, deleted: del.deleted, finalCount: afterDel.length };
      })()`,
    );
    assert.deepEqual(afterRestart, {
      survivedCount: 1,
      survivedNote: "updated chrome note",
      deleted: 1,
      finalCount: 0,
    });
    assert.deepEqual(moments.exceptions, []);
    console.log("✔ Service Worker cold-wake + IndexedDB durability + delete verified");

    // 4. Open firebase-guide.html and privacy.html to verify Chrome static copy, scroll-spy, rules, and snippet verifier.
    const guide = await openExtensionPage(cdp, `${extOrigin}/src/moments/firebase-guide.html`);
    const guideCheck = await cdp.evaluate(
      guide.sessionId,
      `(() => {
        const rulesText = document.getElementById("rulesCode")?.textContent || "";
        const tester = document.getElementById("snippetTester");
        tester.value = 'const firebaseConfig = { apiKey: "AIzaTestKey", databaseURL: "https://demo-rtdb.firebaseio.com" };';
        tester.dispatchEvent(new Event("input"));
        const resultText = document.getElementById("snippetTesterResult")?.textContent || "";
        const activeTrack = document.querySelector(".cue-track__link.is-active")?.textContent?.trim() || "";
        const bodyText = document.body.textContent || "";
        return {
          hasRules: rulesText.includes("cuepointV2") && rulesText.includes("auth.uid == $uid"),
          verifierOk: resultText.includes("demo-rtdb.firebaseio.com"),
          activeTrack,
          hasChromeCopy: bodyText.includes("Connect Chrome") && bodyText.includes("CuePoint Chrome"),
          leaksFirefox: /\\b(Firefox|Add-ons)\\b/i.test(bodyText),
        };
      })()`,
    );
    assert.equal(guideCheck.hasRules, true);
    assert.equal(guideCheck.verifierOk, true);
    assert.match(guideCheck.activeTrack, /01\s*Create project/);
    assert.equal(guideCheck.hasChromeCopy, true);
    assert.equal(guideCheck.leaksFirefox, false);
    assert.deepEqual(guide.exceptions, []);
    console.log("✔ firebase-guide.html Chrome copy, rules syntax render, snippet verifier, and cue-track verified");

    const privacy = await openExtensionPage(cdp, `${extOrigin}/src/moments/privacy.html`);
    const privacyCheck = await cdp.evaluate(
      privacy.sessionId,
      `(() => {
        const activeTrack = document.querySelector(".priv-track__link.is-active")?.textContent?.trim() || "";
        const bodyText = document.body.textContent || "";
        return {
          activeTrack,
          hasChromeCopy: bodyText.includes("Chrome profile") && bodyText.includes("Chrome Web Store listing"),
          leaksFirefox: /\\b(Firefox|Add-ons)\\b/i.test(bodyText),
        };
      })()`,
    );
    assert.match(privacyCheck.activeTrack, /01\s*On device/);
    assert.equal(privacyCheck.hasChromeCopy, true);
    assert.equal(privacyCheck.leaksFirefox, false);
    assert.deepEqual(privacy.exceptions, []);
    assert.deepEqual(swExceptions, []);
    console.log("✔ privacy.html Chrome copy, active section-track, and zero runtime exceptions verified");

    console.log("\nAll real-Chromium MV3 smoke checks passed.");
  } finally {
    cdp?.close();
    if (proc && !proc.killed) {
      proc.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("Chrome smoke test failed:", err);
  process.exitCode = 1;
});
