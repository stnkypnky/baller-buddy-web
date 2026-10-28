import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { handleProxy } from "./worker/lib/proxy";
import { handleRelay } from "./worker/lib/relay";

/** The data proxy and AI relay, served by the dev server the way the Worker
 *  serves them in production, so `npm run dev` needs no Cloudflare
 *  tooling. (Push needs `npm run preview`.) */
function devProxy(): Plugin {
  const mount = (handler: (r: Request) => Promise<Response>): Connect.NextHandleFunction => async (req, res) => {
    const url = new URL(req.originalUrl ?? req.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const body = req.method === "POST" ? Buffer.concat(chunks) : undefined;
    const out = await handler(new Request(url, { method: req.method, headers, body }));
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    if (!out.body) return res.end();
    const reader = out.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
  return {
    name: "bb-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/proxy", mount((r) => handleProxy(r)));
      server.middlewares.use("/api/ai-relay", mount(handleRelay));
    },
  };
}

// The app lives in web/. The Cloudflare Worker (worker/) serves dist/ plus the /api routes.
export default defineConfig({
  root: "web",
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    devProxy(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: "/",
        name: "Baller Buddy",
        short_name: "Baller Buddy",
        description: "Scores, stats, Game Pulse and an AI analyst",
        start_url: "/",
        scope: "/",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        background_color: "#07090d",
        theme_color: "#07090d",
        categories: ["sports"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Live", url: "/#/live", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
          { name: "AI Analyst", url: "/#/ai", icons: [{ src: "icon-192.png", sizes: "192x192" }] },
        ],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
