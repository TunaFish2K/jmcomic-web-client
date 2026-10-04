import type { ReactNode } from "react";
import { Input, Label, ListBox, Select, TextField } from "@heroui/react";

/** Labelled text input. Extra input props (name, type, autoComplete…) pass through to the input. */
export function TextInput({ label, hideLabel = false, className = "", value, defaultValue, onChange, name, type = "text",
    autoComplete, placeholder, maxLength, isRequired, inputMode }: {
    label: string;
    hideLabel?: boolean;
    className?: string;
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    name?: string;
    type?: "text" | "email" | "password" | "url" | "date" | "search";
    autoComplete?: string;
    placeholder?: string;
    maxLength?: number;
    isRequired?: boolean;
    inputMode?: "text" | "email" | "numeric" | "url";
}) {
    return (
        <TextField value={value} defaultValue={defaultValue} onChange={onChange} name={name} type={type} isRequired={isRequired}
            className={`flex min-w-0 flex-col gap-1 ${className}`}>
            <Label className={hideLabel ? "sr-only" : "text-xs text-muted"}>{label}</Label>
            <Input autoComplete={autoComplete} placeholder={placeholder} maxLength={maxLength} inputMode={inputMode} className="h-10 w-full" />
        </TextField>
    );
}

/** react-aria keys cannot be empty, so "" (e.g. the default sort order) uses a stand-in key. */
const EMPTY_KEY = "__empty";
const toKey = (value: string) => value === "" ? EMPTY_KEY : value;
const fromKey = (key: string) => key === EMPTY_KEY ? "" : key;

/** Dropdown in the same style as the search page's sort and time selects. */
export function SelectField<T extends string>({ label, value, options, onChange, className = "", hideLabel = true, placeholder }: {
    label: string;
    value: T;
    options: ReadonlyArray<readonly [T, ReactNode]>;
    onChange: (value: T) => void;
    className?: string;
    hideLabel?: boolean;
    placeholder?: string;
}) {
    return (
        <Select aria-label={hideLabel ? label : undefined} variant="secondary" className={`min-w-0 ${className}`}
            value={toKey(value)} placeholder={placeholder}
            onChange={(next) => { if (next !== null && next !== undefined) onChange(fromKey(String(next)) as T); }}>
            {!hideLabel && <Label className="text-xs text-muted">{label}</Label>}
            <Select.Trigger className="h-10 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
                <ListBox>
                    {options.map(([id, text]) => (
                        <ListBox.Item key={toKey(id)} id={toKey(id)} textValue={typeof text === "string" ? text : id}>{text}</ListBox.Item>
                    ))}
                </ListBox>
            </Select.Popover>
        </Select>
    );
}
