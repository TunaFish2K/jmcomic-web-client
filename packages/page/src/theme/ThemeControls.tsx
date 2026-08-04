import { ColorArea, ColorPicker, ColorSlider, ColorSwatchPicker, Popover } from '@heroui/react';
import { Check, Monitor, Moon, Palette, RotateCcw, Sun } from 'lucide-react';
import { useTheme } from './theme-context';
import { normalizeHexColor, THEME_PRESETS, type ThemeMode } from './theme';

const MODE_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '系统', icon: Monitor },
];

export function ThemePanel({ tone = 'adaptive' }: { tone?: 'adaptive' | 'dark' }) {
  const {
    preferences,
    accentColor,
    setMode,
    setPreset,
    setCustomAccent,
    resetTheme,
  } = useTheme();
  const forceDark = tone === 'dark';

  const mutedText = forceDark ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400';
  const segmentBg = forceDark ? 'bg-gray-800' : 'bg-gray-100 dark:bg-gray-800';
  const inactiveMode = forceDark
    ? 'text-gray-300 hover:bg-white/5'
    : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5';
  const inputClass = forceDark
    ? 'border-gray-700 bg-gray-900 text-gray-100'
    : 'border-gray-300 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  const commitHexDraft = (input: HTMLInputElement) => {
    const normalized = normalizeHexColor(input.value);
    if (normalized) {
      setCustomAccent(normalized);
      input.value = normalized;
    } else {
      input.value = accentColor;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className={`mb-2 text-xs font-medium ${mutedText}`}>显示模式</div>
        <div className={`grid grid-cols-3 gap-1 rounded-lg p-1 ${segmentBg}`}>
          {MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = preferences.mode === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(value)}
                className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md text-xs transition-colors ${active ? 'bg-brand-500 text-brand-foreground shadow-sm' : inactiveMode}`}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className={`mb-2 text-xs font-medium ${mutedText}`}>强调色</div>
        <ColorSwatchPicker
          aria-label="主题强调色"
          value={preferences.accent.kind === 'preset' ? accentColor : undefined}
          onChange={(color) => {
            const selected = normalizeHexColor(color.toString('hex'));
            const preset = THEME_PRESETS.find((candidate) => candidate.color === selected);
            if (preset) setPreset(preset.id);
          }}
          className="flex flex-wrap gap-2"
        >
          {THEME_PRESETS.map((preset) => (
            <ColorSwatchPicker.Item key={preset.id} color={preset.color} aria-label={preset.label}>
              <ColorSwatchPicker.Swatch className="h-8 w-8" />
              <ColorSwatchPicker.Indicator>
                <Check size={14} strokeWidth={2.5} />
              </ColorSwatchPicker.Indicator>
            </ColorSwatchPicker.Item>
          ))}
        </ColorSwatchPicker>
      </div>

      <div>
        <div className={`mb-2 text-xs font-medium ${mutedText}`}>自定义</div>
        <div className="flex items-center gap-2">
          <ColorPicker
            aria-label="自定义强调色"
            value={accentColor}
            onChange={(color) => setCustomAccent(color.toString('hex'))}
          >
            <ColorPicker.Trigger
              className="h-9 w-11 shrink-0 rounded-md border border-gray-400/40 p-1 shadow-sm"
              aria-label="选择自定义颜色"
            >
              <span className="block h-full w-full rounded-sm" style={{ backgroundColor: accentColor }} />
            </ColorPicker.Trigger>
            <ColorPicker.Popover className="z-[100] w-64 space-y-3 p-3" placement="bottom left">
              <ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness" className="h-36 w-full">
                <ColorArea.Thumb />
              </ColorArea>
              <ColorSlider colorSpace="hsb" channel="hue">
                <ColorSlider.Track>
                  <ColorSlider.Thumb />
                </ColorSlider.Track>
              </ColorSlider>
            </ColorPicker.Popover>
          </ColorPicker>
          <input
            type="text"
            aria-label="十六进制强调色"
            key={accentColor}
            defaultValue={accentColor}
            maxLength={7}
            spellCheck={false}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              event.target.value = next;
              const normalized = normalizeHexColor(next);
              if (normalized && next.replace('#', '').length === 6) setCustomAccent(normalized);
            }}
            onBlur={(event) => commitHexDraft(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitHexDraft(event.currentTarget);
                event.currentTarget.blur();
              }
            }}
            className={`h-9 min-w-0 flex-1 rounded-md border px-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 ${inputClass}`}
          />
          <button
            type="button"
            onClick={resetTheme}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors ${forceDark ? 'border-gray-700 text-gray-400 hover:bg-white/5 hover:text-white' : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white'}`}
            aria-label="恢复默认主题"
            title="恢复默认主题"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ThemePopover({ className = '' }: { className?: string }) {
  const { accentColor } = useTheme();
  return (
    <Popover>
      <Popover.Trigger
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 ${className}`}
        aria-label="外观设置"
        title="外观"
      >
        <Palette size={18} />
        <span
          className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-white/80 shadow-sm dark:border-gray-900"
          style={{ backgroundColor: accentColor }}
        />
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="z-[90] w-72 p-0">
        <Popover.Dialog className="p-4 outline-none">
          <Popover.Heading className="mb-4 text-sm font-semibold">外观</Popover.Heading>
          <ThemePanel />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
