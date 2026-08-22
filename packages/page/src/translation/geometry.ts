import type { NormalizedPoint } from "./types";

export type Rect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

export function clampUnit(value: number) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function getNormalizedPolygon(
    points: Array<{ x: number; y: number }>,
    width: number,
    height: number,
): NormalizedPoint[] {
    if (width <= 0 || height <= 0) return [];
    return points.map((point) => ({
        x: clampUnit(point.x / width),
        y: clampUnit(point.y / height),
    }));
}

export function getPolygonBounds(points: NormalizedPoint[]): Rect {
    if (points.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
    const xs = points.map((point) => clampUnit(point.x));
    const ys = points.map((point) => clampUnit(point.y));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { left, top, width: right - left, height: bottom - top };
}

export function getContainedImageRect({
    elementWidth,
    elementHeight,
    naturalWidth,
    naturalHeight,
}: {
    elementWidth: number;
    elementHeight: number;
    naturalWidth: number;
    naturalHeight: number;
}): Rect {
    if (
        elementWidth <= 0 ||
        elementHeight <= 0 ||
        naturalWidth <= 0 ||
        naturalHeight <= 0
    ) {
        return { left: 0, top: 0, width: 0, height: 0 };
    }
    const scale = Math.min(
        elementWidth / naturalWidth,
        elementHeight / naturalHeight,
    );
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    return {
        left: (elementWidth - width) / 2,
        top: (elementHeight - height) / 2,
        width,
        height,
    };
}
