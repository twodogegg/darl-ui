import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Explicit cleanup is required because global Vitest hooks are not enabled.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
