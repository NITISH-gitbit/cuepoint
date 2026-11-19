# CuePoint — YouTube Timestamp Bookmarks

CuePoint saves a bookmark to a specific second in a YouTube video. Add a note, then search your saved moments and jump back to the original timestamp.

## Install and use

CuePoint targets **Firefox 142 or later on desktop and Android**. Once listed for your platform, install it from Firefox Add-ons. To test this source checkout on desktop, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select [manifest.json](manifest.json). Firefox removes temporary add-ons when it restarts. For Android development setup, see [Mozilla’s guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

1. Open a regular video in Firefox (`www.youtube.com` on desktop or `m.youtube.com` on Android). Refresh any YouTube tab that was already open when you installed CuePoint. The native YouTube app and Shorts aren’t supported.
2. At the point you want to keep, choose **Save moment** below the player. Add an optional note and choose **Save**. CuePoint accepts up to three moments per video. Saving the same second twice leaves the original note unchanged.
3. Open **CuePoint** from Firefox’s Extensions menu or toolbar. Select a timestamp to see its note, open the video at that point, edit the note, or copy the link.

## Storage and privacy

CuePoint keeps bookmarks on this device by default. Use **Export** in the Moments page to make a JSON backup. Optional Firebase sync uses your own Firebase project and a separate cloud library. Follow the [step-by-step Firebase setup guide](FIREBASE_SETUP.md), or open **Cloud (BYOC) → How to set up Firebase & Security Rules** in CuePoint. Existing bookmarks are not uploaded automatically; use **Copy Local Moments** if you want them in your cloud library.

See the [privacy policy](src/moments/privacy.html) for what is stored, what optional sync sends, and how to stop sync or delete data.

## Development

- `npm install` installs the Firefox extension tools.
- `npm test` runs the local Node test suite.
- `npm run lint` validates the extension.
- `npm run build` creates the unsigned submission ZIP.

For a problem you can reproduce, include your Firefox version, which CuePoint mode you used, and the steps to reproduce it. Don’t include your Firebase password, tokens, or private notes. Use the support contact on the Firefox Add-ons listing once available.

## License

CuePoint is licensed under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) for the upstream MIT copyright and permission notice.
