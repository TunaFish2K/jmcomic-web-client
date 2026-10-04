import { useState } from "react";
import { useExtendedPreferences } from "./preferences";

/**
 * Turns extended mode on or off. The first time it is turned on, the user confirms that
 * account data passes through this deployment's Worker.
 */
export function ExtendedModeToggle() {
    const { preferences, setEnabled } = useExtendedPreferences();
    const [confirming, setConfirming] = useState(false);
    const toggle = () => {
        if (preferences.enabled) setEnabled(false);
        else if (preferences.acknowledged) setEnabled(true);
        else setConfirming(true);
    };
    return (
        <div className="space-y-2 text-sm">
            <label className="flex items-center justify-between gap-3">
                <span>
                    <span className="block font-medium">扩展模式</span>
                    <span className="block text-xs text-gray-500">首页推荐、分类排行和账号功能</span>
                </span>
                <input type="checkbox" role="switch" aria-label="扩展模式" className="h-5 w-5 accent-brand-500"
                    checked={preferences.enabled} onChange={toggle} />
            </label>
            {confirming && (
                <div role="alertdialog" aria-label="开启扩展模式" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <p>扩展模式会显示更多上游内容。登录时，账号和密码会经过本站部署者的 Worker 转发到上游，部署者有能力看到它们。只在信任部署者时登录。</p>
                    <div className="flex gap-2">
                        <button type="button" className="rounded-md bg-amber-600 px-3 py-1 text-white" onClick={() => { setEnabled(true); setConfirming(false); }}>我已了解，开启</button>
                        <button type="button" className="rounded-md border border-amber-400 px-3 py-1" onClick={() => setConfirming(false)}>取消</button>
                    </div>
                </div>
            )}
        </div>
    );
}
