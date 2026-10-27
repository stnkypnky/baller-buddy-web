import "@fontsource-variable/inter";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./index.css";

import * as Tooltip from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { registerSW } from "virtual:pwa-register";
import App from "./App";

// Installable + offline; a new build activates on the next launch.
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider>
        <HashRouter>
          <App />
        </HashRouter>
        <Toaster
          theme="dark"
          position="bottom-right"
          offset={96}
          toastOptions={{
            style: {
              background: "rgb(13 16 23 / 0.95)",
              border: "1px solid rgb(255 255 255 / 0.08)",
              backdropFilter: "blur(12px)",
            },
          }}
        />
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
