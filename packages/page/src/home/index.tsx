import { useState } from "react";
import { Button, InputGroup, Select, ListBox } from "@heroui/react";
import { SearchIcon } from "lucide-react";
import type { Key } from "@heroui/react";

export default function Home() {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<Key>("all");
    console.log(category);

    return (
        <div className="fixed inset-0 flex flex-col items-center pt-20">
            <div className="w-full max-w-xl px-4">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                    }}
                    className="w-full flex items-center"
                >
                    <InputGroup className="h-12 w-full flex-1 min-w-0">
                        <InputGroup.Prefix className="p-0 flex-shrink-0">
                            <Select
                                aria-label="搜索类别"
                                className="w-24 min-w-[96px] h-full"
                                variant="secondary"
                                value={category}
                                onChange={(value) =>
                                    setCategory(value || "all")
                                }
                                placeholder="选择类别"
                            >
                                <Select.Trigger className="h-full rounded-none border-none shadow-none bg-transparent px-3 flex items-center justify-center gap-1">
                                    <Select.Value className="text-center flex-1" />
                                    <Select.Indicator className="flex-shrink-0" />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item
                                            id="all"
                                            textValue="全部"
                                        >
                                            全部
                                        </ListBox.Item>
                                        <ListBox.Item
                                            id="work"
                                            textValue="作品名称"
                                        >
                                            作品名称
                                        </ListBox.Item>
                                        <ListBox.Item
                                            id="author"
                                            textValue="作者"
                                        >
                                            作者
                                        </ListBox.Item>
                                        <ListBox.Item
                                            id="tag"
                                            textValue="标签"
                                        >
                                            标签
                                        </ListBox.Item>
                                        <ListBox.Item
                                            id="actor"
                                            textValue="角色"
                                        >
                                            角色
                                        </ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                        </InputGroup.Prefix>
                        <InputGroup.Input
                            placeholder="搜索内容..."
                            name="query"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="flex-1 min-w-0"
                        />
                        <InputGroup.Suffix className="p-0 flex-shrink-0">
                            <Button
                                type="submit"
                                className="h-full rounded-none px-4 flex-shrink-0"
                                variant="primary"
                            >
                                <SearchIcon size={18} />
                            </Button>
                        </InputGroup.Suffix>
                    </InputGroup>
                </form>
            </div>
        </div>
    );
}
