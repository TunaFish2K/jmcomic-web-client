import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';
import { DEFAULT_THEME_PREFERENCES, THEME_STORAGE_KEY } from '../src/theme/theme';

vi.mock('@heroui/react', () => {
  const ColorSwatchPicker = ({ children, onChange }: { children: ReactNode; onChange: (color: { toString: () => string }) => void }) => (
    <div><button type="button" onClick={() => onChange({ toString: () => '#00DD99' })}>choose preset</button>{children}</div>
  );
  ColorSwatchPicker.Item = ({ children, 'aria-label': label }: { children: ReactNode; 'aria-label': string }) => <div aria-label={label}>{children}</div>;
  ColorSwatchPicker.Swatch = () => <span />;
  ColorSwatchPicker.Indicator = ({ children }: { children: ReactNode }) => <>{children}</>;
  const ColorPicker = ({ onChange }: { onChange: (color: { toString: () => string }) => void }) => <button type="button" onClick={() => onChange({ toString: () => '#123456' })}>picker change</button>;
  ColorPicker.Trigger = ({ children }: { children: ReactNode }) => <>{children}</>;
  ColorPicker.Popover = ({ children }: { children: ReactNode }) => <>{children}</>;
  const ColorArea = ({ children }: { children: ReactNode }) => <>{children}</>;
  ColorArea.Thumb = () => null;
  const ColorSlider = ({ children }: { children: ReactNode }) => <>{children}</>;
  ColorSlider.Track = ({ children }: { children: ReactNode }) => <>{children}</>;
  ColorSlider.Thumb = () => null;
  const Popover = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  Popover.Trigger = ({ children, ...props }: { children: ReactNode }) => <button type="button" {...props}>{children}</button>;
  Popover.Content = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  Popover.Dialog = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  Popover.Heading = ({ children }: { children: ReactNode }) => <h2>{children}</h2>;
  return { ColorArea, ColorPicker, ColorSlider, ColorSwatchPicker, Popover };
});

import { ThemePanel, ThemePopover } from '../src/theme/ThemeControls';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { ThemeContext, useTheme, type ThemeContextValue } from '../src/theme/theme-context';
import { initializeTheme } from '../src/theme/theme-dom';

function ThemeProbe() {
  const theme = useTheme();
  return (
    <div>
      <span data-testid="mode">{theme.preferences.mode}:{theme.resolvedMode}:{theme.accentColor}</span>
      <button type="button" onClick={() => theme.setMode('dark')}>dark</button>
      <button type="button" onClick={() => theme.setPreset('coral')}>coral</button>
      <button type="button" onClick={() => theme.setCustomAccent('nope')}>invalid</button>
      <button type="button" onClick={() => theme.setCustomAccent('#123456')}>custom</button>
      <button type="button" onClick={theme.resetTheme}>reset</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  let listeners: Set<(event: MediaQueryListEvent) => void>;

  beforeEach(() => {
    window.localStorage.clear();
    listeners = new Set();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => listeners.add(callback),
        removeEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => listeners.delete(callback),
      })),
    });
  });

  test('commits modes, presets, custom accents, reset, and system media updates', () => {
    const view = render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    assert.equal(screen.getByTestId('mode').textContent, 'system:light:#00DD99');
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    assert.match(screen.getByTestId('mode').textContent!, /^dark:dark:/);
    assert.equal(document.documentElement.dataset.themeMode, 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'coral' }));
    assert.match(screen.getByTestId('mode').textContent!, /#E85D75$/);
    fireEvent.click(screen.getByRole('button', { name: 'invalid' }));
    assert.match(screen.getByTestId('mode').textContent!, /#E85D75$/);
    fireEvent.click(screen.getByRole('button', { name: 'custom' }));
    assert.match(screen.getByTestId('mode').textContent!, /#123456$/);
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    assert.equal(screen.getByTestId('mode').textContent, 'system:light:#00DD99');
    act(() => { for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent); });
    assert.equal(screen.getByTestId('mode').textContent, 'system:dark:#00DD99');
    view.unmount();
    assert.equal(listeners.size, 0);
  });

  test('syncs current and legacy storage events and ignores unrelated keys', () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    fireEvent(window, new StorageEvent('storage', { key: 'other', newValue: 'dark' }));
    assert.match(screen.getByTestId('mode').textContent!, /^system:/);
    fireEvent(window, new StorageEvent('storage', {
      key: THEME_STORAGE_KEY,
      newValue: JSON.stringify({ version: 1, mode: 'light', accent: { kind: 'preset', id: 'coral' } }),
    }));
    assert.equal(screen.getByTestId('mode').textContent, 'light:light:#E85D75');
    fireEvent(window, new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    assert.match(screen.getByTestId('mode').textContent!, /^dark:dark:/);
  });

  test('requires the provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    assert.throws(() => renderHook(() => useTheme()), /ThemeProvider/);
    error.mockRestore();
  });

  test('initializes the root from persisted preferences', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      version: 1,
      mode: 'dark',
      accent: { kind: 'custom', value: '#123456' },
    }));
    const preferences = initializeTheme();
    assert.equal(preferences.mode, 'dark');
    assert.equal(document.documentElement.classList.contains('dark'), true);
    assert.equal(document.documentElement.style.getPropertyValue('--theme-accent'), '#123456');
  });
});

describe('Theme controls', () => {
  test('changes modes, preset and picker colors, validates hex input, resets, and renders popover', () => {
    const value: ThemeContextValue = {
      preferences: DEFAULT_THEME_PREFERENCES,
      resolvedMode: 'light',
      accentColor: '#00DD99',
      setMode: vi.fn(),
      setPreset: vi.fn(),
      setCustomAccent: vi.fn(() => true),
      resetTheme: vi.fn(),
    };
    render(<ThemeContext.Provider value={value}><ThemePanel tone="dark" /><ThemePopover className="extra" /></ThemeContext.Provider>);
    fireEvent.click(screen.getAllByRole('button', { name: '深色' })[0]);
    assert.deepEqual((value.setMode as ReturnType<typeof vi.fn>).mock.calls[0], ['dark']);
    fireEvent.click(screen.getAllByRole('button', { name: 'choose preset' })[0]);
    assert.deepEqual((value.setPreset as ReturnType<typeof vi.fn>).mock.calls[0], ['jade']);
    fireEvent.click(screen.getAllByRole('button', { name: 'picker change' })[0]);
    assert.ok((value.setCustomAccent as ReturnType<typeof vi.fn>).mock.calls.some((call) => call[0] === '#123456'));

    const input = screen.getAllByRole('textbox', { name: '十六进制强调色' })[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '#abcdef' } });
    assert.equal(input.value, '#ABCDEF');
    fireEvent.change(input, { target: { value: 'oops' } });
    fireEvent.blur(input);
    assert.equal(input.value, '#00DD99');
    fireEvent.change(input, { target: { value: '#123456' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getAllByRole('button', { name: '恢复默认主题' })[0]);
    assert.equal((value.resetTheme as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.ok(screen.getByRole('button', { name: '外观设置' }));
    assert.ok(screen.getByRole('heading', { name: '外观' }));
  });
});
