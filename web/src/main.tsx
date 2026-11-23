import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./styles.css";

// Vercel Web Analytics and Speed Insights (free tier, cookie-free; only active on Vercel).
inject();
injectSpeedInsights();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
