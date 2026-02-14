import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BrowserRouter } from "react-router-dom";
import Home from "./home";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <Home></Home>
        </BrowserRouter>
    </StrictMode>,
);
