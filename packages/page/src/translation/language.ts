import type { OcrRegion, TranslationPageStatus } from "./types";

const MIN_CHINESE_HAN_CHARACTERS = 12;
const MIN_CHINESE_SCRIPT_RATIO = 0.9;
const HAN_CHARACTER = /\p{Script=Han}/gu;
const KANA_CHARACTER = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;

function countMatches(value: string, pattern: RegExp) {
    return value.match(pattern)?.length ?? 0;
}

export function detectOcrPageStatus(
    regions: Pick<OcrRegion, "text">[],
): TranslationPageStatus | null {
    const text = regions.map((region) => region.text).join("\n");
    const hanCount = countMatches(text, HAN_CHARACTER);
    if (hanCount < MIN_CHINESE_HAN_CHARACTERS) return null;

    const kanaCount = countMatches(text, KANA_CHARACTER);
    const scriptRatio = hanCount / (hanCount + kanaCount);
    return scriptRatio >= MIN_CHINESE_SCRIPT_RATIO ? "already_chinese" : null;
}
