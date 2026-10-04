import { Switch, Tabs } from "@heroui/react";

/**
 * One-of-N choice shown as tabs. `fullWidth` stretches the options evenly, as in the
 * theme mode picker; otherwise the list scrolls horizontally on narrow screens.
 */
export function Segmented<T extends string>({ label, options, value, onChange, fullWidth = false, className = "" }: {
    label: string;
    options: ReadonlyArray<readonly [T, string]>;
    value: T;
    onChange: (value: T) => void;
    fullWidth?: boolean;
    className?: string;
}) {
    return (
        <Tabs selectedKey={value} onSelectionChange={(key) => onChange(String(key) as T)} className={className}>
            <Tabs.ListContainer className={fullWidth ? "" : "overflow-x-auto"}>
                <Tabs.List aria-label={label} className={fullWidth ? "w-full" : "w-max"}>
                    {options.map(([id, text]) => (
                        <Tabs.Tab key={id} id={id} className={`${fullWidth ? "flex-1" : ""} whitespace-nowrap px-3 text-sm`}>
                            {text}
                            <Tabs.Indicator />
                        </Tabs.Tab>
                    ))}
                </Tabs.List>
            </Tabs.ListContainer>
        </Tabs>
    );
}

/** A labelled on/off setting. The label doubles as the accessible name. */
export function SettingSwitch({ label, description, checked, onChange, isDisabled, className = "" }: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    isDisabled?: boolean;
    className?: string;
}) {
    return (
        <Switch isSelected={checked} onChange={onChange} isDisabled={isDisabled} aria-label={label}
            className={`flex w-full items-center justify-between gap-3 ${className}`}>
            <span className="min-w-0 text-sm">
                <span className="block">{label}</span>
                {description && <span className="block text-xs text-muted">{description}</span>}
            </span>
            <Switch.Control className="shrink-0">
                <Switch.Thumb />
            </Switch.Control>
        </Switch>
    );
}
