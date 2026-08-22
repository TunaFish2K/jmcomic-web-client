import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getContainedImageRect, getPolygonBounds, type Rect } from "./geometry";
import type { PageTranslationRecord, TranslatedRegion } from "./types";

function FittedTranslationBox({
    region,
    rect,
}: {
    region: TranslatedRegion;
    rect: Rect;
}) {
    const [showSource, setShowSource] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const text = showSource ? region.text : region.translation;
    const vertical = rect.height > rect.width * 1.35;

    useLayoutEffect(() => {
        const element = buttonRef.current;
        if (!element || rect.width < 2 || rect.height < 2) return;
        let low = 6;
        let high = 28;
        let best = low;
        while (low <= high) {
            const candidate = Math.floor((low + high) / 2);
            element.style.fontSize = `${candidate}px`;
            const fits =
                element.scrollWidth <= element.clientWidth + 1 &&
                element.scrollHeight <= element.clientHeight + 1;
            if (fits) {
                best = candidate;
                low = candidate + 1;
            } else {
                high = candidate - 1;
            }
        }
        element.style.fontSize = `${best}px`;
    }, [rect.height, rect.width, text, vertical]);

    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                setShowSource((value) => !value);
            }}
            aria-label={showSource ? "显示中文译文" : "显示日文原文"}
            title={showSource ? "点击显示中文译文" : "点击显示日文原文"}
            className={`pointer-events-auto absolute z-[12] overflow-hidden border bg-white/90 p-0.5 text-gray-950 shadow-sm backdrop-blur-[1px] ${
                region.score < 0.65 ? "border-amber-400" : "border-black/15"
            }`}
            style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                minWidth: 2,
                minHeight: 2,
                borderRadius: 3,
                fontSize: 12,
                lineHeight: 1.05,
                writingMode: vertical ? "vertical-rl" : "horizontal-tb",
                textOrientation: "mixed",
                wordBreak: "break-all",
                overflowWrap: "anywhere",
                letterSpacing: 0,
            }}
        >
            {text}
        </button>
    );
}

export function TranslationLayer({
    imageRef,
    record,
    visible,
}: {
    imageRef: React.RefObject<HTMLImageElement | null>;
    record: PageTranslationRecord;
    visible: boolean;
}) {
    const layerRef = useRef<HTMLDivElement>(null);
    const [contentRect, setContentRect] = useState<Rect | null>(null);

    const measure = useCallback(() => {
        const image = imageRef.current;
        const layer = layerRef.current;
        if (
            !image ||
            !layer ||
            image.naturalWidth <= 0 ||
            image.naturalHeight <= 0
        )
            return;
        const imageRect = image.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        const contained = getContainedImageRect({
            elementWidth: imageRect.width,
            elementHeight: imageRect.height,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
        });
        setContentRect({
            left: imageRect.left - layerRect.left + contained.left,
            top: imageRect.top - layerRect.top + contained.top,
            width: contained.width,
            height: contained.height,
        });
    }, [imageRef]);

    useLayoutEffect(() => {
        measure();
        const image = imageRef.current;
        const layer = layerRef.current;
        if (!image || !layer) return;
        const observer = new ResizeObserver(measure);
        observer.observe(image);
        observer.observe(layer);
        const mutationObserver = new MutationObserver(measure);
        mutationObserver.observe(image, {
            attributes: true,
            attributeFilter: ["style"],
        });
        image.addEventListener("load", measure);
        window.addEventListener("resize", measure);
        return () => {
            observer.disconnect();
            mutationObserver.disconnect();
            image.removeEventListener("load", measure);
            window.removeEventListener("resize", measure);
        };
    }, [imageRef, measure, record.key]);

    return (
        <div
            ref={layerRef}
            className="pointer-events-none absolute inset-0 z-[12]"
        >
            {visible &&
                contentRect &&
                record.regions.map((region) => {
                    const bounds = getPolygonBounds(region.polygon);
                    return (
                        <FittedTranslationBox
                            key={`${region.id}:${region.translation}`}
                            region={region}
                            rect={{
                                left:
                                    contentRect.left +
                                    bounds.left * contentRect.width,
                                top:
                                    contentRect.top +
                                    bounds.top * contentRect.height,
                                width: bounds.width * contentRect.width,
                                height: bounds.height * contentRect.height,
                            }}
                        />
                    );
                })}
        </div>
    );
}

export function ReaderTranslatedImage({
    src,
    className,
    record,
    translationVisible,
    onLoad,
}: {
    src: string;
    className: string;
    record: PageTranslationRecord | null;
    translationVisible: boolean;
    onLoad: React.ReactEventHandler<HTMLImageElement>;
}) {
    const imageRef = useRef<HTMLImageElement>(null);
    return (
        <>
            <img
                ref={imageRef}
                src={src}
                alt=""
                draggable={false}
                className={className}
                onLoad={onLoad}
            />
            {record && (
                <TranslationLayer
                    imageRef={imageRef}
                    record={record}
                    visible={translationVisible}
                />
            )}
        </>
    );
}
