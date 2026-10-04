import { Dropdown } from "@heroui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { termSearchUrl, type AlbumTermKind, type TermAction } from "./term-url";

/** An album tag, author, character or parody that opens 只搜这个 / 加入当前搜索 / 排除. */
/** `onSearch` runs after navigating, e.g. to close the album dialog over the new results. */
export function TermMenu({ text, kind, className, onSearch }: { text: string; kind: AlbumTermKind; className: string; onSearch?: () => void }) {
    const navigate = useNavigate();
    const { search } = useLocation();
    const hasSearch = !!new URLSearchParams(search).get("q");
    const run = (action: TermAction) => {
        navigate(termSearchUrl(action, text, kind, new URLSearchParams(search)));
        onSearch?.();
    };
    return (
        <Dropdown>
            <Dropdown.Trigger aria-label={`${text}：搜索选项`}
                className={`${className} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500`}>
                {text}
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom start">
                <Dropdown.Menu aria-label={`${text} 的搜索选项`} onAction={(key) => run(String(key) as TermAction)}>
                    <Dropdown.Item id="only" textValue="只搜这个">只搜这个</Dropdown.Item>
                    <Dropdown.Item id="add" textValue={hasSearch ? "加入当前搜索" : "加入搜索"}>{hasSearch ? "加入当前搜索" : "加入搜索"}</Dropdown.Item>
                    <Dropdown.Item id="exclude" textValue="排除">排除</Dropdown.Item>
                </Dropdown.Menu>
            </Dropdown.Popover>
        </Dropdown>
    );
}
