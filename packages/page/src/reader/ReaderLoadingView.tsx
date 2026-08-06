export function ReaderLoadingView() {
  return (
    <div className="fixed inset-0 bg-black select-none">
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">加载中...</span>
        </div>
      </div>
    </div>
  );
}
