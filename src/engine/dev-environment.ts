// Development mock environment for running Editor Studio and Popup inside standard Vite HMR dev server
// (e.g. http://localhost:5173/editor.html) without chrome extension runtime crashes.

export const isExtensionEnvironment = Boolean(
  typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id
);

export function ensureDevChromeMocks(): void {
  if (isExtensionEnvironment) return;

  if (typeof window === 'undefined') return;

  console.log(
    '%c[SmoothStudio Dev]%c Standalone Web Dev Server detected. Active mock Chrome API initialized for React Fast Refresh.',
    'color: #8B5CF6; font-weight: bold;',
    'color: inherit;'
  );

  const mockSessionStore: Record<string, any> = {
    isRecording: false,
    activeRecordingTabId: null,
    activeEditorTabId: 1
  };

  const mockLocalStore: Record<string, any> = {};

  (window as any).chrome = (window as any).chrome || {};

  (window as any).chrome.runtime = (window as any).chrome.runtime || {
    id: 'smoothstudio-dev-hmr',
    lastError: null,
    getURL: (path: string) => `/${path.replace(/^\//, '')}`,
    sendMessage: (message: any, responseCallback?: (response: any) => void) => {
      console.log('[Dev Mock chrome.runtime.sendMessage]', message);
      const res = { status: 'ok', mock: true, type: message?.type };
      if (responseCallback) responseCallback(res);
      return Promise.resolve(res);
    },
    connect: ({ name }: { name: string }) => {
      console.log(`[Dev Mock chrome.runtime.connect] Port opened: "${name}"`);
      return {
        name,
        onMessage: { addListener: () => {}, removeListener: () => {} },
        onDisconnect: { addListener: () => {}, removeListener: () => {} },
        postMessage: (msg: any) => console.log(`[Dev Mock Port "${name}"] postMessage:`, msg),
        disconnect: () => console.log(`[Dev Mock Port "${name}"] disconnected`)
      };
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false
    }
  };

  (window as any).chrome.storage = (window as any).chrome.storage || {
    session: {
      get: async (keys?: any) => {
        if (!keys) return { ...mockSessionStore };
        if (typeof keys === 'string') return { [keys]: mockSessionStore[keys] };
        if (Array.isArray(keys)) {
          const res: Record<string, any> = {};
          keys.forEach((k) => (res[k] = mockSessionStore[k]));
          return res;
        }
        return { ...mockSessionStore };
      },
      set: async (items: Record<string, any>) => {
        Object.assign(mockSessionStore, items);
      }
    },
    local: {
      get: async (keys?: any) => {
        if (!keys) return { ...mockLocalStore };
        if (typeof keys === 'string') return { [keys]: mockLocalStore[keys] };
        if (Array.isArray(keys)) {
          const res: Record<string, any> = {};
          keys.forEach((k) => (res[k] = mockLocalStore[k]));
          return res;
        }
        return { ...mockLocalStore };
      },
      set: async (items: Record<string, any>) => {
        Object.assign(mockLocalStore, items);
      }
    }
  };

  (window as any).chrome.tabs = (window as any).chrome.tabs || {
    query: (_queryInfo: any, callback?: (tabs: any[]) => void) => {
      const mockTabs = [{ id: 1, url: window.location.href, active: true, title: 'SmoothStudio Dev' }];
      if (callback) callback(mockTabs);
      return Promise.resolve(mockTabs);
    },
    sendMessage: (tabId: number, message: any, callback?: (response: any) => void) => {
      console.log(`[Dev Mock chrome.tabs.sendMessage to Tab ${tabId}]`, message);
      if (callback) callback({ success: true, tabId });
      return Promise.resolve({ success: true, tabId });
    },
    update: (_tabId: number, _props: any, callback?: (tab: any) => void) => {
      if (callback) callback({ id: 1, active: true });
      return Promise.resolve({ id: 1, active: true });
    },
    create: (props: any, callback?: (tab: any) => void) => {
      console.log('[Dev Mock chrome.tabs.create]', props);
      if (props.url) window.open(props.url, '_blank');
      if (callback) callback({ id: 2, url: props.url });
      return Promise.resolve({ id: 2, url: props.url });
    }
  };
}
