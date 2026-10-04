import type { ReactNode } from "react";
import { Modal } from "@heroui/react";

/**
 * The app's dialog. HeroUI's Modal provides Escape to close, a focus trap, scroll lock,
 * `aria-modal` and returns focus to the opener; clicking the backdrop closes it.
 */
export function AppDialog({ title, onClose, children, footer, header, size = "md", tone, className = "" }: {
    /** Accessible name; also the visible heading unless `header` replaces it. */
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    /** Custom header content shown instead of the plain title. */
    header?: ReactNode;
    size?: "xs" | "sm" | "md" | "lg";
    /** "dark" keeps the reader's always-dark look regardless of the app theme. */
    tone?: "dark";
    className?: string;
}) {
    return (
        <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }} isDismissable>
            <Modal.Container size={size} scroll="inside" className={tone === "dark" ? "dark" : undefined}>
                <Modal.Dialog aria-label={title} className={`max-h-[85vh] rounded-xl bg-surface text-foreground ${className}`}>
                    <Modal.Header className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            {header ?? <Modal.Heading className="text-base font-semibold">{title}</Modal.Heading>}
                        </div>
                        <Modal.CloseTrigger aria-label="关闭" className="shrink-0" />
                    </Modal.Header>
                    <Modal.Body className="space-y-3 text-sm">{children}</Modal.Body>
                    {footer && <Modal.Footer>{footer}</Modal.Footer>}
                </Modal.Dialog>
            </Modal.Container>
        </Modal.Backdrop>
    );
}
