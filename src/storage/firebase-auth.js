var YTM = YTM || {};

(function () {
  "use strict";

  const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1";
  const TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

  const ERROR_MESSAGES = {
    EMAIL_NOT_FOUND: "No account found for that email.",
    INVALID_PASSWORD: "Incorrect password.",
    INVALID_LOGIN_CREDENTIALS: "Invalid email or password.",
    EMAIL_EXISTS: "An account with this email already exists.",
    WEAK_PASSWORD: "Password should be at least 6 characters.",
    INVALID_EMAIL: "Please enter a valid email address.",
    USER_DISABLED: "This account has been disabled in Firebase.",
    OPERATION_NOT_ALLOWED: "Enable Email/Password sign-in in Firebase Authentication.",
    TOKEN_EXPIRED: "Session revoked by Firebase. Please sign in again.",
    INVALID_REFRESH_TOKEN: "Session expired. Please sign in again.",
  };

  function normalizeErrorCode(code, fallback) {
    if (!code) return fallback;
    const clean = String(code).split(":")[0].trim();
    return clean || fallback;
  }

  function friendlyError(code, fallback) {
    const clean = normalizeErrorCode(code, "");
    if (!clean) return fallback || "Firebase authentication failed.";
    return ERROR_MESSAGES[clean] || fallback || clean;
  }

  function normalizeDatabaseUrl(raw) {
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    let u;
    try {
      u = new URL(trimmed);
    } catch {
      return "";
    }
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (!host.endsWith(".firebaseio.com") && !host.endsWith(".firebasedatabase.app")) {
      return "";
    }
    return u.origin;
  }

  function stripJsComments(text) {
    // Strip block comments and line comments outside of URLs (avoid breaking https://)
    return text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  function extractField(text, fieldName) {
    const re = new RegExp(
      `(?:^|[{,\\s])["'\`]?${fieldName}["'\`]?\\s*:\\s*(["'\`])([^"'\`]+)\\1`,
      "m",
    );
    const match = text.match(re);
    return match ? match[2].trim() : "";
  }

  function parseFirebaseConfigSnippet(raw) {
    if (typeof raw !== "string") {
      return { apiKey: "", databaseURL: "", projectId: "", valid: false };
    }
    const cleaned = stripJsComments(raw.trim());
    const apiKey = extractField(cleaned, "apiKey");
    const rawDbUrl = extractField(cleaned, "databaseURL");
    const databaseURL = normalizeDatabaseUrl(rawDbUrl);
    const projectId = extractField(cleaned, "projectId");

    return {
      apiKey,
      databaseURL,
      projectId,
      valid: !!(apiKey && databaseURL),
    };
  }

  async function postAuth(url, body, fetchFn = fetch) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rawCode = data && data.error && data.error.message;
      const err = new Error(friendlyError(rawCode, `Auth request failed (${res.status})`));
      err.code = normalizeErrorCode(rawCode, "AUTH_ERROR");
      throw err;
    }
    return data;
  }

  async function signIn({ apiKey, email, password }, fetchFn = fetch) {
    const data = await postAuth(
      `${AUTH_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      { email, password, returnSecureToken: true },
      fetchFn,
    );
    const expiresInSec = Number(data.expiresIn) || 3600;
    return {
      uid: data.localId,
      email: data.email || email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
  }

  async function signUp({ apiKey, email, password }, fetchFn = fetch) {
    const data = await postAuth(
      `${AUTH_BASE}/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
      { email, password, returnSecureToken: true },
      fetchFn,
    );
    const expiresInSec = Number(data.expiresIn) || 3600;
    return {
      uid: data.localId,
      email: data.email || email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
  }

  async function refreshIdToken({ apiKey, refreshToken }, fetchFn = fetch) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetchFn(`${TOKEN_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rawCode = data && data.error && data.error.message;
      const err = new Error(friendlyError(rawCode, `Token refresh failed (${res.status})`));
      err.code = normalizeErrorCode(rawCode, "TOKEN_REFRESH_ERROR");
      throw err;
    }
    const expiresInSec = Number(data.expires_in) || 3600;
    return {
      idToken: data.id_token,
      refreshToken: data.refresh_token || refreshToken,
      uid: data.user_id,
      expiresAt: Date.now() + expiresInSec * 1000,
    };
  }

  const api = {
    normalizeDatabaseUrl,
    parseFirebaseConfigSnippet,
    signIn,
    signUp,
    refreshIdToken,
  };

  YTM.firebaseAuth = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
