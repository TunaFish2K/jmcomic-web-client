import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme/ThemeProvider";
import { initializeTheme } from "./theme/theme-dom";
import "./pwa";

initializeTheme();

const queryClient = new QueryClient();

const Home = lazy(() => import("./home"));
const ReaderPage = lazy(() => import("./reader"));

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <Suspense fallback={null}>
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/reader/:albumId" element={<ReaderPage />} />
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </QueryClientProvider>
        </ThemeProvider>
    </StrictMode>,
);
