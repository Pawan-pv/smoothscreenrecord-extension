import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';
import { createMockChrome, MockChrome } from './mocks/chrome-mock';

declare global {
  // eslint-disable-next-line no-var
  var chrome: MockChrome;
}

beforeEach(() => {
  // Attach a fresh instance of mock Chrome APIs before each test
  (globalThis as any).chrome = createMockChrome();
  vi.clearAllMocks();
});
