/** Comment bodies are upstream HTML; only their text is shown, never the markup. */
export function htmlToText(html: string): string {
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
    return text.replace(/\s+\n/g, "\n").trim();
}

/** Monday = 1 … Sunday = 7, as the official app numbers serialization days. */
export function todayIndex(date = new Date()) {
    const day = date.getDay();
    return day === 0 ? 7 : day;
}

/** Shown wherever a user may sign in. */
export const TRUST_NOTICE = "账号和密码会经过本站部署者的 Worker 转发到上游，只在信任部署者时登录。";
