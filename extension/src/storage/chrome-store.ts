import type { KeyValueStore, SessionStore } from "../../../shared/vault.ts";

export class ChromeLocalStore implements KeyValueStore {
  async getAll(): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(null);
  }

  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }

  async set(values: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(values);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length) await chrome.storage.local.remove(keys);
  }
}

export class ChromeSessionStore implements SessionStore {
  async get(key: string): Promise<unknown> {
    const result = await chrome.storage.session.get(key);
    return result[key];
  }

  async set(values: Record<string, unknown>): Promise<void> {
    await chrome.storage.session.set(values);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length) await chrome.storage.session.remove(keys);
  }
}
