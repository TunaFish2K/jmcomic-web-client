/**
 * Upstream search syntax, as measured against `/search` (see docs/mobile-api.md):
 * - terms are separated by spaces (ASCII or full-width) or commas;
 * - plain terms are OR'ed; one `+term` anywhere turns every positive term into AND;
 * - `-term` excludes; prefixes only count at the start of a term;
 * - case and simplified/traditional variants are folded by the server.
 * The serialized string is what goes into the `?q=` URL parameter.
 */
export type Token = { text: string; exclude: boolean };
export type QueryMode = "all" | "any";
export type TagQuery = { tokens: Token[]; mode: QueryMode };

const SEPARATORS = /[\s,，\u3000]+/u;

/** Comparison key: same term regardless of width or case. */
export function normalizeTerm(text: string): string {
    return text.normalize("NFKC").toLowerCase();
}

/** Turns typed text such as `-NTR` into a token; returns null for empty or bare operators. */
export function parseToken(raw: string): Token | null {
    const trimmed = raw.trim();
    const exclude = trimmed.startsWith("-");
    const text = trimmed.replace(/^[+-]+/, "").trim();
    return text ? { text, exclude } : null;
}

/** Adds or replaces a token. A term appears once; the latest include/exclude choice wins. */
export function upsertToken(tokens: Token[], token: Token): Token[] {
    const key = normalizeTerm(token.text);
    return [...tokens.filter((item) => normalizeTerm(item.text) !== key), token];
}

export function parseQuery(query: string): TagQuery {
    const parts = query.split(SEPARATORS).filter(Boolean);
    let tokens: Token[] = [];
    for (const part of parts) {
        const token = parseToken(part);
        if (token) tokens = upsertToken(tokens, token);
    }
    const required = parts.some((part) => part.startsWith("+") && part.length > 1);
    const includes = tokens.filter((token) => !token.exclude).length;
    // Legacy links like `?q=a b` keep their OR meaning; everything else defaults to AND.
    return { tokens, mode: !required && includes > 1 ? "any" : "all" };
}

export function serializeQuery({ tokens, mode }: TagQuery): string {
    const includes = tokens.filter((token) => !token.exclude);
    // A single required term matches the same as a plain one, so keep simple URLs simple.
    const prefix = mode === "all" && includes.length > 1 ? "+" : "";
    return tokens.map((token) => `${token.exclude ? "-" : prefix}${token.text}`).join(" ");
}
