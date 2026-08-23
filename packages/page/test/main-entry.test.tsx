import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
  initializeTheme: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: state.createRoot,
}));
vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  Routes: ({ children }: { children: React.ReactNode }) => children,
  Route: () => null,
}));
vi.mock('@tanstack/react-query', () => ({
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../src/theme/ThemeProvider', () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../src/theme/theme-dom', () => ({ initializeTheme: state.initializeTheme }));
vi.mock('../src/pwa', () => ({}));
vi.mock('../src/home', () => ({ default: () => null }));
vi.mock('../src/reader', () => ({ default: () => null }));

test('initializes global UI services and mounts the application root', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  state.render.mockReset();
  state.createRoot.mockReset().mockReturnValue({ render: state.render });
  state.initializeTheme.mockReset();
  vi.resetModules();
  await import('../src/main');
  assert.equal(state.initializeTheme.mock.calls.length, 1);
  assert.equal(state.createRoot.mock.calls[0][0], document.getElementById('root'));
  assert.equal(state.render.mock.calls.length, 1);
  const visit = async (node: unknown): Promise<void> => {
    if (!node || typeof node !== 'object') return;
    const element = node as { type?: unknown; props?: { children?: unknown; element?: unknown } };
    const lazyType = element.type as { _payload?: { _result?: () => Promise<unknown> } } | undefined;
    if (typeof lazyType?._payload?._result === 'function') await lazyType._payload._result();
    await visit(element.props?.element);
    const children = element.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) await visit(child);
    } else {
      await visit(children);
    }
  };
  await visit(state.render.mock.calls[0][0]);
});
