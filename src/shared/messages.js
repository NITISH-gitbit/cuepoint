var YTM = YTM || {};

(function () {
  "use strict";

  const ACTIONS = Object.freeze({
    GET_MOMENTS: "ytm:get_moments",
    ADD_MOMENT: "ytm:add_moment",
    UPDATE_MOMENT: "ytm:update_moment",
    DELETE_MOMENT: "ytm:delete_moment",
    IMPORT_MOMENTS: "ytm:import_moments",
    GET_SYNC_STATUS: "ytm:get_sync_status",
    GET_ACTIVE_LIBRARY: "ytm:get_active_library",
    CLOUD_SIGN_IN: "ytm:cloud_sign_in",
    CLOUD_SIGN_UP: "ytm:cloud_sign_up",
    CLOUD_SIGN_OUT: "ytm:cloud_sign_out",
    CLOUD_SET_MODE: "ytm:cloud_set_mode",
    CLOUD_SYNC_NOW: "ytm:cloud_sync_now",
    CLOUD_RECOVER: "ytm:cloud_recover",
    CLOUD_IMPORT_LOCAL: "ytm:cloud_import_local",
    RESOLVE_SYNC_CONFLICT: "ytm:resolve_sync_conflict",
  });

  function getExtApi() {
    if (typeof browser !== "undefined" && browser.runtime) return browser;
    if (typeof chrome !== "undefined" && chrome.runtime) return chrome;
    return null;
  }

  async function sendAction(type, payload = {}) {
    const ext = getExtApi();
    if (!ext || !ext.runtime || !ext.runtime.sendMessage) {
      throw new Error("Extension runtime messaging is unavailable");
    }
    const res = await ext.runtime.sendMessage({ type, payload });
    if (!res || res.ok !== true) {
      throw new Error((res && res.error) || `Action ${type} failed`);
    }
    return res.data;
  }

  const api = {
    ACTIONS,
    getExtApi,
    sendAction,
  };

  YTM.messages = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
