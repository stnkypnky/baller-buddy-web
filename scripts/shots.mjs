// Screenshots of every page with sample data (no network needed), at desktop
// and phone widths, and a check that no page scrolls sideways.
//   npm run dev &   then   node scripts/shots.mjs <outDir> [baseUrl]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright is resolved like require() would (a global install works).
const { chromium } = createRequire(import.meta.url)("playwright");
import { sampleFor } from "./sample-data.mjs";

const out = process.argv[2] ?? "shots";
const base = process.argv[3] ?? "http://localhost:5173";
mkdirSync(out, { recursive: true });

const ALL_ROUTES = ["/", "/roster", "/player/1628369", "/stats", "/trends", "/news", "/league", "/scores", "/compare", "/live", "/pulse/401700100", "/ai", "/settings"];
const ALL_SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
// Narrow a run: SIZES=phone ROUTES=/,/roster node scripts/shots.mjs out
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(",") : ALL_ROUTES;
const SIZES = Object.fromEntries(Object.entries(ALL_SIZES).filter(([k]) => !process.env.SIZES || process.env.SIZES.split(",").includes(k)));

const browser = await chromium.launch();
let problems = 0;
for (const [label, viewport] of Object.entries(SIZES)) {
  // The page scrolls inside the app shell, so "full page" means a tall window.
  if (process.env.FULL) viewport.height = 2400;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: label === "phone" ? 2 : 1, isMobile: label === "phone", hasTouch: label === "phone" });
  await ctx.route("**/api/proxy?*", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url");
    const hit = target && sampleFor(target);
    if (hit) return route.fulfill({ status: 200, contentType: hit[0], body: hit[1] });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${label}] page error: ${e.message}`));
  for (const r of ROUTES) {
    await page.goto(`${base}/#${r}`);
    await page.waitForTimeout(r === ROUTES[0] ? 3500 : Number(process.env.WAIT ?? 2500));
    const name = `${label}${r === "/" ? "_home" : r.replace(/\//g, "_")}.png`;
    await page.screenshot({ path: `${out}/${name}` });
    const wide = await page.evaluate(() => {
      const sc = document.querySelector("main .scroll") ?? document.documentElement;
      const offenders = [];
      for (const el of sc.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (b.width && b.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed") offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 4).join(".")} → ${Math.round(b.right)}px`);
      }
      return { scrollW: sc.scrollWidth, clientW: sc.clientWidth, offenders: offenders.slice(0, 6) };
    });
    const bad = wide.scrollW > wide.clientW + 1;
    if (bad) problems++;
    console.log(`${bad ? "✗" : "✓"} ${label} ${r}${bad ? `  overflow ${wide.scrollW}>${wide.clientW}: ${wide.offenders.join(" | ")}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `${problems} page(s) scroll sideways` : "no sideways scrolling");
process.exit(0);
