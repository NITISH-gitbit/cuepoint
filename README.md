# CuePoint — YouTube Timestamp Bookmarks

CuePoint saves a bookmark to a specific second in a YouTube video. Add a note, then search your saved moments and jump back to the original timestamp.

## Install and use

CuePoint targets **Firefox 142 or later (desktop and Android)** and **Google Chrome 116 or later (desktop)**.

- **Firefox (desktop & Android):** Install from Firefox Add-ons once listed. To test from source on desktop, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select [manifest.json](manifest.json) (or `dist/firefox/manifest.json`). For Android setup, see [Mozilla’s guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).
- **Chrome (desktop):** Build unpacked bundles with `npm run build:chrome`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome/`.

1. Open a regular video (`www.youtube.com` on desktop, or `m.youtube.com` on Firefox for Android). Refresh any YouTube tab that was already open when you installed CuePoint. The native YouTube app and Shorts aren’t supported.
2. At the point you want to keep, choose **Save moment** below the player. Add an optional note and choose **Save**. CuePoint accepts up to three moments per video. Saving the same second twice leaves the original note unchanged.
3. Open **CuePoint** from your browser’s Extensions menu or toolbar. Select a timestamp to see its note, open the video at that point, edit the note, or copy the link.

## Storage and privacy

CuePoint keeps bookmarks on this device by default. Use **Export** in the Moments page to make a JSON backup. Optional Firebase sync uses your own Firebase project and a separate cloud library. Follow the [step-by-step Firebase setup guide](FIREBASE_SETUP.md), or open **Cloud (BYOC) → How to set up Firebase & Security Rules** in CuePoint. Existing bookmarks are not uploaded automatically; use **Copy Local Moments** if you want them in your cloud library.

See the [privacy policy](src/moments/privacy.html) for what is stored, what optional sync sends, and how to stop sync or delete data.

## Development

- `npm install` installs the Firefox `web-ext` tool.
- `npm test` runs the local Node unit/integration test suite.
- `npm run build:all` builds clean unpacked bundles into `dist/firefox/` and `dist/chrome/` (`npm run build:zips` also generates store ZIPs).
- `npm run build:icons` regenerates `targets/chrome/icons/cuepoint-{16,32,48,128}.png` from [icons/cuepoint.svg](icons/cuepoint.svg) using local Chromium/Edge.
- `npm run test:chrome` runs the headless Chromium MV3 smoke test against `dist/chrome/`.
- `npm run lint` validates the root checkout (`npm run lint:firefox` validates `dist/firefox/`).
- `npm run build` creates the Firefox unsigned submission ZIP via `web-ext`.

For a problem you can reproduce, include your browser and version, which CuePoint mode you used, and the steps to reproduce it. Don’t include your Firebase password, tokens, or private notes. Use the support contact on the store listing once available.

## License

CuePoint is licensed under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) for the upstream MIT copyright and permission notice.
