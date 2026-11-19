# Firefox Add-ons release checklist

- Keep the add-on ID stable after the first publication. List this release for Firefox desktop only.
- Keep [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) in the package. Review the redistribution terms for any new third-party material before adding it.
- Run `npm test`, `npm run lint`, and `npm run build`. Inspect the unsigned ZIP before uploading it to AMO. Use the listing title **CuePoint — YouTube Timestamp Bookmarks** and select the MIT license.
- Test the packaged release in a fresh Firefox profile against desktop YouTube: save, duplicate save, keyboard focus after Save and Escape, open the saved timestamp, search, edit, delete, and JSON export/import.
- Use a dedicated Firebase test project and two Firefox profiles. Verify optional data and host permission denial, later consent, sign-in, live sync in both directions, offline retry, and revocation in Firefox’s Add-ons Manager. After revocation, confirm local saves still work and cloud requests stop. Never use personal credentials for review.
- Add a support contact you control in AMO. Enter the [privacy policy](src/moments/privacy.html) in AMO’s privacy policy field. Upload two screenshots from a clean profile with non-private examples: saving a specific second on YouTube and finding that timestamp in Moments.
- In AMO reviewer notes, explain the complete local save flow and that Firebase is optional. Include test steps and, if needed for sync review, disposable Firebase credentials for a dedicated test project. Share them only with reviewers.
