export const STORAGE_VERSION = 2;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sanitizeCueMap = (map, duration = Infinity) => {
  if (!isObject(map)) return {};
  const next = {};
  Object.entries(map).forEach(([key, value]) => {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0 && num <= duration) {
      next[key] = num;
    }
  });
  return next;
};

export const migrateCues = (raw, duration) => {
  if (!raw) {
    return { version: STORAGE_VERSION, data: { cues: {}, updatedAt: Date.now() } };
  }
  if (isObject(raw) && typeof raw.version === "number" && isObject(raw.data)) {
    if (raw.version === STORAGE_VERSION) return raw;
    if (raw.version === 1) {
      return {
        version: STORAGE_VERSION,
        data: {
          cues: sanitizeCueMap(raw.data.cues, duration),
          updatedAt: raw.data.updatedAt || Date.now()
        }
      };
    }
  }

  const legacy = sanitizeCueMap(raw, duration);
  return {
    version: STORAGE_VERSION,
    data: { cues: legacy, updatedAt: Date.now() }
  };
};

export const migrateGlobal = (raw) => {
  if (!raw) {
    return { version: STORAGE_VERSION, data: { midiMappings: {} } };
  }
  if (isObject(raw) && typeof raw.version === "number" && isObject(raw.data)) {
    if (raw.version === STORAGE_VERSION) return raw;
    if (raw.version === 1) {
      return {
        version: STORAGE_VERSION,
        data: {
          midiMappings: isObject(raw.data.midiMappings) ? raw.data.midiMappings : {}
        }
      };
    }
  }

  return {
    version: STORAGE_VERSION,
    data: {
      midiMappings: isObject(raw.midiMappings) ? raw.midiMappings : raw
    }
  };
};
