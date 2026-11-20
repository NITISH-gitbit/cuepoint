var YTM = YTM || {};

(function () {
  "use strict";

  const defaultPlatform =
    typeof module !== "undefined" && module.exports ? require("./platform") : YTM.platform;

  function createCloudConsent(ext, platform = defaultPlatform) {
    const manifest = ext.runtime.getManifest();
    const data = manifest.browser_specific_settings?.gecko?.data_collection_permissions?.optional || [];
    const origins = manifest.optional_host_permissions || [];
    const requiresDataConsent = data.length > 0;
    const permissions = () => (requiresDataConsent ? { data_collection: [...data], origins: [...origins] } : { origins: [...origins] });
    const unsupported = platform?.consentUnsupportedError
      || "Firefox data consent is unavailable. Cloud Sync is disabled; local storage still works.";
    const denied = platform?.consentDeniedError
      || "Firefox data and network permissions are required for Cloud Sync. Local storage still works.";

    async function isGranted() {
      if (!origins.length) return false;
      try {
        if (requiresDataConsent) {
          // Older Firefox versions can ignore an unknown Permissions field. Never treat
          // a successful host-only contains() call as authorization to transmit data.
          const granted = await ext.permissions.getAll();
          if (!Array.isArray(granted.data_collection) || !data.every((type) => granted.data_collection.includes(type))) {
            return false;
          }
        }
        return await ext.permissions.contains(permissions());
      } catch {
        return false;
      }
    }

    async function request() {
      if (!origins.length || !ext.permissions?.request) throw new Error(unsupported);
      // Call request before awaiting anything so the browser sees the original click.
      if (!(await ext.permissions.request(permissions()))) {
        throw new Error(denied);
      }
      if (!(await isGranted())) throw new Error(unsupported);
    }

    function affectsCloud(removed) {
      // Firebase hosts are our only optional hosts. A removal can report a
      // narrower host pattern than the one originally requested.
      return !!(
        removed?.origins?.length ||
        (requiresDataConsent && removed?.data_collection?.some((type) => data.includes(type)))
      );
    }

    return { isGranted, request, affectsCloud };
  }

  YTM.cloudConsent = { createCloudConsent };
  if (typeof module !== "undefined" && module.exports) module.exports = YTM.cloudConsent;
})();
