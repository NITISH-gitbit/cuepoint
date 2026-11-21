# Release checklist (Firefox AMO & Chrome Web Store)

## Shared pre-flight checks

- Run `npm test`, `npm run lint`, `npm run lint:firefox`, `npm run build`, and `npm run test:chrome`.
- Keep [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) inside every built package. Review redistribution terms before adding any new third-party material.
- Inspect both `dist/cuepoint-firefox-<version>.zip` and `dist/cuepoint-chrome-<version>.zip` before uploading.

## Firefox Add-ons (AMO)

- Keep the add-on ID (`cuepoint@local`) stable after first publication. Mark Android as compatible in AMO only after testing on a phone against live mobile YouTube.
- Use the listing title **CuePoint — YouTube Timestamp Bookmarks** and select the MIT license.
- Test the packaged release (`dist/firefox/`) in a fresh Firefox profile against desktop YouTube: save, duplicate save, keyboard focus after Save and Escape, open the saved timestamp, search, edit, delete, and JSON export/import.
- For Android, enable Firefox Nightly’s **Remote debugging via USB**, connect a test device, and run `npm run dev -- -t firefox-android --adb-device <serial> --firefox-apk org.mozilla.fenix`. On `m.youtube.com`, save from a playlist, advance to the next video, and verify there is one button outside the playlist controls. Check that the keyboard does not cover Save and that the saved timestamp reopens from the **Extensions** menu. If testing Cloud Sync, also check permission denial and recovery after backgrounding Firefox.
- Use a dedicated Firebase test project and two Firefox profiles. Verify optional data and host permission denial, later consent, sign-in, live sync in both directions, offline retry, and revocation in Firefox’s Add-ons Manager. After revocation, confirm local saves still work and cloud requests stop. Never use personal credentials for review.
- Add a support contact you control in AMO. Enter the [privacy policy](src/moments/privacy.html) in AMO’s privacy policy field. Upload two screenshots from a clean profile with non-private examples: saving a specific second on YouTube and finding that timestamp in Moments.
- In AMO reviewer notes, explain the complete local save flow and that Firebase is optional. Include test steps and, if needed for sync review, disposable Firebase credentials for a dedicated test project. Share them only with reviewers.

## Chrome Web Store (CWS)

- Upload `dist/cuepoint-chrome-<version>.zip` built from `targets/chrome/` (contains PNG `16`/`32`/`48`/`128` icons, `sw.js`, `"minimum_chrome_version": "116"`, and Chrome-specific guide/privacy copy).
- Verify `dist/chrome/` unpacked via `chrome://extensions` on desktop Chrome against live `www.youtube.com`:
  - Save moment, duplicate save, max 3 moments per video, note popover keyboard shortcuts/Escape focus restoration, SPA navigation across playlist tracks, search, edit, delete, JSON import/export, and Light/Dark theme persistence.
  - Confirm the **Allow in Incognito** switch is disabled (`"incognito": "not_allowed"`).
  - Clear Chrome browsing history/cache (`chrome://settings/clearBrowserData`) and verify locally saved moments remain intact.
  - With a disposable Firebase test project, test denying optional host permissions (stays Local), granting host permissions, signing in, bidirectional sync with a second profile, letting the Service Worker unload (>40s idle) and confirming immediate recovery via `CLOUD_RECOVER` on tab focus (`moments.html`), and revoking host access under `chrome://extensions` → Site access.
- **Privacy tab & permission justifications in Developer Dashboard:**
  - Match disclosures strictly to `dist/chrome/src/moments/privacy.html` (no developer servers, analytics, or ads; local-only by default; email/password + bookmark data sent solely to the user-configured Firebase project when Cloud Sync is enabled).
  - **Single-purpose description:** Bookmark and annotate specific timestamps in YouTube videos with optional user-hosted Firebase sync.
  - **`https://www.youtube.com/*` content script justification:** Injects the inline **Save moment** button and reads the active video ID, title, channel, and playback second only when the user saves a timestamp.
  - **`optional_host_permissions` (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `*.firebaseio.com`, `*.firebasedatabase.app`) justification:** Requested at runtime only when a user opts into Bring-Your-Own-Cloud Firebase sync.
  - **Review notes:** Explain local-first usage first, note that Cloud (BYOC) is strictly optional, and provide disposable Firebase project test config/credentials if reviewers wish to test live sync.
