import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./home";
import ReaderPage from "./reader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { ThemeProvider } from "./theme/ThemeProvider";
import { initializeTheme } from "./theme/theme-dom";

initializeTheme();

const queryClient = new QueryClient();

// Register service worker — auto-updates silently in background
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/reader/:albumId" element={<ReaderPage />} />
                    </Routes>
                </BrowserRouter>
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
