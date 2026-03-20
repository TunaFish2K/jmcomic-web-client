import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./home";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";

// 初始化深色模式
const theme = localStorage.getItem("theme");
if (
    theme === "dark" ||
    (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)
) {
    document.documentElement.classList.add("dark");
} else {
    document.documentElement.classList.remove("dark");
}

const queryClient = new QueryClient();

// Register service worker — auto-updates silently in background
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <Routes>
                    {" "}
                    <Route path="/" element={<Home />} />
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>
    </StrictMode>,
);
