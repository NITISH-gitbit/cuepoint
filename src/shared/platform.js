var YTM = YTM || {};

(function () {
  "use strict";

  const platform = Object.freeze({
    id: "firefox",
    browserName: "Firefox",
    extensionsMenuHint: "Firefox’s Extensions menu or toolbar",
    consentUnsupportedError:
      "Firefox data consent is unavailable. Cloud Sync is disabled; local storage still works.",
    consentDeniedError:
      "Firefox data and network permissions are required for Cloud Sync. Local storage still works.",
    consentRequiredError:
      "Firefox data and network permissions are required for Cloud Sync. Select Cloud to resume after granting them.",
    cloudDisclosure:
      "Cloud Sync sends saved YouTube links, timestamps, video details, and notes to your Firebase project. Google Firebase Authentication receives your email, password at sign-in, and session credentials. You can revoke data permissions in Firefox’s Add-ons Manager under Permissions and Data. ",
  });

  YTM.platform = platform;
  if (typeof module !== "undefined" && module.exports) module.exports = platform;
})();
