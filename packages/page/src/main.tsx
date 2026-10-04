import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme/ThemeProvider";
import { initializeTheme } from "./theme/theme-dom";
import { ensureBackendPreconnect } from "./backend-url";
import { Root } from "./root";
import "./pwa";

initializeTheme();
ensureBackendPreconnect();

const queryClient = new QueryClient();

const ReaderPage = lazy(() => import("./reader"));

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Suspense fallback={null}>
                        <Routes>
                            <Route path="/" element={<Root />} />
                            <Route path="/discover" element={<Root />} />
                            <Route path="/favorites" element={<Root />} />
                            <Route path="/me" element={<Root />} />
                            <Route path="/reader/:albumId" element={<ReaderPage />} />
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
