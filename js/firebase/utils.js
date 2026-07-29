export const stripUndefined = value => JSON.parse(JSON.stringify(value ?? null));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function isConnectionError(err) {
  return ["unavailable", "deadline-exceeded"].includes(err?.code)
    || String(err?.message || "").toLowerCase().includes("client is offline");
}

export async function withRetry(action, { api, db }) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0 && db) await api.enableNetwork(db).catch(() => {});
      return await action();
    } catch (err) {
      lastErr = err;
      if (!isConnectionError(err) || attempt === 2) break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}
