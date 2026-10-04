import { parseQuery, serializeQuery, upsertToken } from "./query";

/** Search scope (the `cat` parameter) that fits each kind of album term. */
export const TERM_SCOPE = { author: "2", tag: "3", actor: "4", work: "0" } as const;
export type AlbumTermKind = keyof typeof TERM_SCOPE;

export type TermAction = "only" | "add" | "exclude";

/**
 * Builds the search URL for an action on a term, relative to the current search (if any).
 * The upstream cannot match phrases, so a multi-word term ("Blue Archive") becomes one
 * required (or excluded) word per part.
 */
export function termSearchUrl(action: TermAction, text: string, kind: AlbumTermKind, current: URLSearchParams) {
    const exclude = action === "exclude";
    const words = parseQuery(text).tokens.map((token) => ({ text: token.text, exclude }));
    const currentQuery = action === "only" ? "" : current.get("q") ?? "";
    const base = currentQuery ? parseQuery(currentQuery) : { tokens: [], mode: "all" as const };
    const tokens = words.reduce(upsertToken, base.tokens);
    const params = new URLSearchParams();
    params.set("q", serializeQuery({ tokens, mode: currentQuery ? base.mode : "all" }));
    // A new positive search uses the term's own field; refinements keep the current scope.
    params.set("cat", currentQuery || exclude ? current.get("cat") ?? "0" : TERM_SCOPE[kind]);
    for (const key of ["order", "time"]) {
        const value = current.get(key);
        if (value) params.set(key, value);
    }
    params.set("page", "1");
    return `/?${params}`;
}
