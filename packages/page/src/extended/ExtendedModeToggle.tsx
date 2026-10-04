import { useState } from "react";
import { Alert, Button } from "@heroui/react";
import { SettingSwitch } from "../ui/controls";
import { useExtendedPreferences } from "./preferences";

/**
 * Turns extended mode on or off. The first time it is turned on, the user confirms that
 * account data passes through this deployment's Worker. The confirmation is inline rather
 * than a modal because the toggle lives inside the appearance popover, which closes when
 * focus moves to another overlay.
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
        <div className="space-y-2">
            <SettingSwitch label="扩展模式" description="首页推荐、分类排行和账号功能" checked={preferences.enabled} onChange={toggle} />
            {confirming && (
                <Alert status="warning" role="alertdialog" aria-label="开启扩展模式" className="flex-wrap gap-2 text-xs">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Description>
                            扩展模式会显示更多上游内容。登录时，账号和密码会经过本站部署者的 Worker 转发到上游，部署者有能力看到它们。只在信任部署者时登录。
                        </Alert.Description>
                    </Alert.Content>
                    <div className="flex w-full gap-2">
                        <Button size="sm" onPress={() => { setEnabled(true); setConfirming(false); }}>我已了解，开启</Button>
                        <Button size="sm" variant="secondary" onPress={() => setConfirming(false)}>取消</Button>
                    </div>
                </Alert>
            )}
        </div>
    );
}
