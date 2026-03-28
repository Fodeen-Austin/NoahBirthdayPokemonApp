const STORAGE_KEY = "pokemon-hunt-state";

export function loadState() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn("localStorage read failed (Safari privacy/quota).", e);
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse saved state.", error);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

/** Returns false if persistence failed (e.g. quota). App keeps running without saving. */
export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn("localStorage write failed (quota or blocked). Progress may not persist.", e);
    return false;
  }
}

export function clearState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("localStorage remove failed.", e);
  }
}
