import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./home";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                {" "}
                <Route path="/" element={<Home />} />
            </Routes>
        </BrowserRouter>
    </StrictMode>,
);
