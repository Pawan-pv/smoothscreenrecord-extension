import { vi } from 'vitest';

export type Listener = (...args: any[]) => void;

export class MockChromeEvent {
  public listeners: Listener[] = [];

  addListener = vi.fn((fn: Listener) => {
    if (!this.listeners.includes(fn)) {
      this.listeners.push(fn);
    }
  });

  removeListener = vi.fn((fn: Listener) => {
    this.listeners = this.listeners.filter((l) => l !== fn);
  });

  hasListener = vi.fn((fn: Listener) => {
    return this.listeners.includes(fn);
  });

  dispatch(...args: any[]): any {
    let result: any = undefined;
    for (const fn of [...this.listeners]) {
      const res = fn(...args);
      if (res !== undefined) result = res;
    }
    return result;
  }

  clear() {
    this.listeners = [];
  }
}

export class MockStorageArea {
  private store: Map<string, any> = new Map();

  async get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>> {
    if (!keys) {
      return Object.fromEntries(this.store);
    }
    const res: Record<string, any> = {};
    if (typeof keys === 'string') {
      if (this.store.has(keys)) res[keys] = this.store.get(keys);
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (this.store.has(k)) res[k] = this.store.get(k);
      }
    } else if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        res[k] = this.store.has(k) ? this.store.get(k) : defaultVal;
      }
    }
    return res;
  }

  async set(items: Record<string, any>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, v);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      this.store.delete(k);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  // Synchronous debug helpers for assertions
  _getRaw(key: string): any {
    return this.store.get(key);
  }

  _setRaw(key: string, value: any): void {
    this.store.set(key, value);
  }
}

export interface MockTab {
  id: number;
  url: string;
  active: boolean;
  title?: string;
  windowId?: number;
}

export class MockPort {
  public name: string;
  public onMessage = new MockChromeEvent();
  public onDisconnect = new MockChromeEvent();
  public postMessage = vi.fn();
  public disconnect = vi.fn(() => {
    this.onDisconnect.dispatch(this);
  });

  constructor(name: string) {
    this.name = name;
  }
}

export function createMockChrome() {
  const sessionStore = new MockStorageArea();
  const localStore = new MockStorageArea();

  const onMessageEvent = new MockChromeEvent();
  const onInstalledEvent = new MockChromeEvent();
  const onStartupEvent = new MockChromeEvent();
  const onConnectEvent = new MockChromeEvent();

  const tabsList: MockTab[] = [
    { id: 101, url: 'https://example.com/app', active: true, title: 'Example App', windowId: 1 }
  ];

  const mockChrome = {
    runtime: {
      id: 'mock-smoothstudio-extension-id',
      lastError: null as { message: string } | null,
      getURL: vi.fn((path: string) => `chrome-extension://mock-smoothstudio-extension-id/${path.replace(/^\//, '')}`),
      sendMessage: vi.fn((message: any, responseCallback?: (response: any) => void) => {
        let responded = false;
        const sendResponse = (resp: any) => {
          responded = true;
          if (responseCallback) responseCallback(resp);
        };
        const sender = { id: 'mock-smoothstudio-extension-id', tab: tabsList[0] };
        const handled = onMessageEvent.dispatch(message, sender, sendResponse);
        if (!responded && handled === true) {
          // Async listener waiting to respond
        }
        return Promise.resolve();
      }),
      connect: vi.fn(({ name }: { name: string }) => {
        const port = new MockPort(name);
        onConnectEvent.dispatch(port);
        return port;
      }),
      reload: vi.fn(),
      onMessage: onMessageEvent,
      onInstalled: onInstalledEvent,
      onStartup: onStartupEvent,
      onConnect: onConnectEvent
    },
    storage: {
      session: sessionStore,
      local: localStore
    },
    tabs: {
      _tabs: tabsList,
      query: vi.fn((queryInfo: any, callback?: (tabs: MockTab[]) => void) => {
        const matched = tabsList.filter((tab) => {
          if (queryInfo.active !== undefined && tab.active !== queryInfo.active) return false;
          if (queryInfo.url) {
            const pattern = queryInfo.url.replace(/\*/g, '.*');
            if (!new RegExp(`^${pattern}$`).test(tab.url)) return false;
          }
          return true;
        });
        if (callback) callback(matched);
        return Promise.resolve(matched);
      }),
      sendMessage: vi.fn((tabId: number, message: any, callback?: (response: any) => void) => {
        const res = { ok: true, success: true, tabId, message };
        if (callback) callback(res);
        return Promise.resolve(res);
      }),
      update: vi.fn((tabId: number, updateProps: any, callback?: (tab: MockTab) => void) => {
        let found = tabsList.find((t) => t.id === tabId);
        if (!found) {
          found = { id: tabId, url: 'https://example.com', active: false };
          tabsList.push(found);
        }
        if (updateProps.active !== undefined) {
          tabsList.forEach((t) => (t.active = false));
          found.active = updateProps.active;
        }
        if (updateProps.url) found.url = updateProps.url;
        if (callback) callback(found);
        return Promise.resolve(found);
      }),
      create: vi.fn((createProps: any, callback?: (tab: MockTab) => void) => {
        const newTab: MockTab = {
          id: Math.floor(Math.random() * 1000) + 200,
          url: createProps.url || 'about:blank',
          active: createProps.active !== false,
          windowId: 1
        };
        if (newTab.active) {
          tabsList.forEach((t) => (t.active = false));
        }
        tabsList.push(newTab);
        if (callback) callback(newTab);
        return Promise.resolve(newTab);
      }),
      reload: vi.fn((tabId?: number, _reloadProps?: any, callback?: () => void) => {
        if (callback) callback();
        return Promise.resolve();
      })
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([]))
    }
  };

  return mockChrome;
}

export type MockChrome = ReturnType<typeof createMockChrome>;
