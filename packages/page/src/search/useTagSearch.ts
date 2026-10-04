import { useId, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { normalizeTerm, parseQuery, parseToken, serializeQuery, upsertToken, type QueryMode, type Token } from "./query";
import { suggest, type Term } from "./vocabulary";

const SEPARATOR = /[\s,，\u3000]/u;

type State = { tokens: Token[]; mode: QueryMode; draft: string };

function withDraft({ tokens, mode, draft }: State) {
    const token = parseToken(draft);
    return { tokens: token ? upsertToken(tokens, token) : tokens, mode };
}

/**
 * State for the tag-style search box. `value` is the upstream query string (the `?q=`
 * value); it always includes the unfinished draft, so a plain form submit searches for
 * exactly what is on screen. A new `value` from outside (navigation) replaces the chips.
 */
export function useTagSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const listId = useId();
    const [state, setState] = useState<State>(() => ({ ...parseQuery(value), draft: "" }));
    const [synced, setSynced] = useState(value);
    const [active, setActive] = useState(-1);
    const [open, setOpen] = useState(false);

    if (value !== synced) {
        setSynced(value);
        setState({ ...parseQuery(value), draft: "" });
        setActive(-1);
    }

    const update = (next: State) => {
        setState(next);
        const effective = serializeQuery(withDraft(next));
        setSynced(effective);
        if (effective !== value) onChange(effective);
    };

    const suggestions: Term[] = useMemo(
        () => open && state.draft.trim() ? suggest(state.draft, state.tokens.map((token) => token.text)) : [],
        [open, state.draft, state.tokens],
    );

    const commitDraft = () => {
        const token = parseToken(state.draft);
        update({ ...state, tokens: token ? upsertToken(state.tokens, token) : state.tokens, draft: "" });
        setActive(-1);
    };

    const pick = (term: Term) => {
        const exclude = state.draft.trim().startsWith("-");
        update({ ...state, tokens: upsertToken(state.tokens, { text: term.text, exclude }), draft: "" });
        setActive(-1);
        setOpen(false);
    };

    const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const text = event.target.value;
        setOpen(true);
        setActive(-1);
        if (!SEPARATOR.test(text)) {
            update({ ...state, draft: text });
            return;
        }
        // Separators finish terms; whatever follows the last one is still being typed.
        const parts = text.split(SEPARATOR);
        const draft = parts.pop() ?? "";
        let tokens = state.tokens;
        for (const part of parts) {
            const token = parseToken(part);
            if (token) tokens = upsertToken(tokens, token);
        }
        update({ ...state, tokens, draft });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        const count = suggestions.length;
        if (event.key === "ArrowDown" && count) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + 1) % count);
        } else if (event.key === "ArrowUp" && count) {
            event.preventDefault();
            setActive((index) => (index <= 0 ? count - 1 : index - 1));
        } else if (event.key === "Escape" && open && count) {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
        } else if (event.key === "Enter" && active >= 0 && active < count) {
            // Choosing a suggestion does not submit; a second Enter searches.
            event.preventDefault();
            pick(suggestions[active]!);
        } else if (event.key === "Enter") {
            commitDraft();
        } else if (event.key === "Tab" && state.draft.trim()) {
            event.preventDefault();
            commitDraft();
        } else if (event.key === "Backspace" && !state.draft && state.tokens.length) {
            event.preventDefault();
            update({ ...state, tokens: state.tokens.slice(0, -1) });
        }
    };

    const includes = state.tokens.filter((token) => !token.exclude).length;
    return {
        tokens: state.tokens,
        mode: state.mode,
        draft: state.draft,
        showMode: includes > 1,
        suggestions,
        active,
        listId,
        optionId: (index: number) => `${listId}-${index}`,
        toggleToken: (token: Token) =>
            update({ ...state, tokens: state.tokens.map((item) => item === token ? { ...item, exclude: !item.exclude } : item) }),
        removeToken: (token: Token) =>
            update({ ...state, tokens: state.tokens.filter((item) => normalizeTerm(item.text) !== normalizeTerm(token.text)) }),
        toggleMode: () => update({ ...state, mode: state.mode === "all" ? "any" : "all" }),
        pick,
        onInputChange,
        onKeyDown,
        onFocus: () => setOpen(true),
        onBlur: () => {
            setOpen(false);
            if (state.draft.trim()) commitDraft();
        },
    };
}

export type TagSearch = ReturnType<typeof useTagSearch>;
