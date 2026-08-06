type ChapterTransitionOverlayProps = {
  snapshot: { url: string; w: number; h: number } | null;
  transitioning: boolean;
};

export function ChapterTransitionOverlay({ snapshot, transitioning }: ChapterTransitionOverlayProps) {
  if (!snapshot) return null;
  return (
    <div
      className={`absolute inset-0 z-30 bg-black flex items-center justify-center transition-opacity duration-700 ${transitioning ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <img
        src={snapshot.url}
        alt=""
        className="max-w-full max-h-full object-contain"
        style={{ width: snapshot.w ? 'auto' : undefined, maxHeight: '100%' }}
        draggable={false}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 border-2 border-brand-500/70 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
}
