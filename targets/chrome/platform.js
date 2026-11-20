var YTM = YTM || {};

(function () {
  "use strict";

  const platform = Object.freeze({
    id: "chrome",
    browserName: "Chrome",
    extensionsMenuHint: "Chrome’s Extensions menu or toolbar",
    consentUnsupportedError:
      "Chrome host permission consent is unavailable. Cloud Sync is disabled; local storage still works.",
    consentDeniedError:
      "Chrome network permissions are required for Cloud Sync. Local storage still works.",
    consentRequiredError:
      "Chrome network permissions are required for Cloud Sync. Select Cloud to resume after granting them.",
    cloudDisclosure:
      "Cloud Sync sends saved YouTube links, timestamps, video details, and notes to your Firebase project. Google Firebase Authentication receives your email, password at sign-in, and session credentials. You can revoke site permissions in Chrome’s Extensions settings (chrome://extensions). ",
  });

  YTM.platform = platform;
  if (typeof module !== "undefined" && module.exports) module.exports = platform;
})();
