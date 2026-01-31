import { migrateCues, migrateGlobal, STORAGE_VERSION } from "./migrations.js";

const hasChromeStorage = typeof chrome !== "undefined" && chrome.storage?.local;

const readStorage = async (key) => {
  if (hasChromeStorage) {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get([key], resolve);
    });
    return result[key] ?? null;
  }
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw error;
  }
};

const writeStorage = async (key, value) => {
  if (hasChromeStorage) {
    await new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
};

const removeStorage = async (key) => {
  if (hasChromeStorage) {
    await new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
    return;
  }
  localStorage.removeItem(key);
};

export const StorageKeys = {
  cues: (videoId) => `ytbm:cues:${videoId}`,
  global: "ytbm:global"
};

export const loadCuesForVideo = async (videoId, duration = Infinity, onError) => {
  const key = StorageKeys.cues(videoId);
  let raw = null;
  try {
    raw = await readStorage(key);
  } catch (error) {
    onError?.("Failed to parse stored cues.", error);
    await removeStorage(key);
  }

  if (!raw) {
    const legacyRaw = localStorage.getItem(`ytbm_cues_${videoId}`);
    if (legacyRaw) {
      try {
        raw = JSON.parse(legacyRaw);
      } catch {
        onError?.("Failed to parse legacy cue storage.", null);
        raw = null;
      }
    }
  }

  const migrated = migrateCues(raw, duration);
  await writeStorage(key, migrated);
  return migrated.data.cues;
};

export const saveCuesForVideo = async (videoId, cues) => {
  const payload = {
    version: STORAGE_VERSION,
    data: {
      cues,
      updatedAt: Date.now()
    }
  };
  await writeStorage(StorageKeys.cues(videoId), payload);
};

export const loadGlobalMappings = async (onError) => {
  let payload = null;
  try {
    payload = await readStorage(StorageKeys.global);
  } catch (error) {
    onError?.("Failed to parse global storage.", error);
    await removeStorage(StorageKeys.global);
    payload = null;
  }
  if (!payload) {
    const legacyRaw = localStorage.getItem("ytbm_mappings");
    if (legacyRaw) {
      try {
        payload = { midiMappings: JSON.parse(legacyRaw) };
      } catch {
        onError?.("Failed to parse legacy midi mappings.", null);
        payload = null;
      }
    }
  }

  const migrated = migrateGlobal(payload);
  await writeStorage(StorageKeys.global, migrated);
  return migrated.data.midiMappings || {};
};

export const saveGlobalMappings = async (midiMappings) => {
  const payload = migrateGlobal({ midiMappings });
  await writeStorage(StorageKeys.global, payload);
};

export const resetStorageKey = async (key) => {
  await removeStorage(key);
};
