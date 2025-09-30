export const safeLoad = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
};

export const safeSave = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/serialization errors and keep the session going.
  }
};
