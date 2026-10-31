// Screenshots of every page with sample data (no network needed), at desktop
// and three phone widths, plus the drawers and pickers, and checks for layout
// that breaks on small screens: sideways scrolling, text clipped by its box,
// and text overlapping other text.
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
const ALL_SIZES = {
  desktop: { width: 1440, height: 900 },
  phone360: { width: 360, height: 780 }, // small Android
  phone390: { width: 390, height: 844 }, // iPhone
  phone412: { width: 412, height: 915 }, // large Android
  land780: { width: 780, height: 360 }, // Galaxy S22 sideways
  land915: { width: 915, height: 412 }, // large Android sideways
  tablet: { width: 820, height: 1180 }, // iPad Air / Android tablet upright
};
// Sizes that are a touch device (phones either way up, tablets).
const TOUCH = /^(phone|land|tablet)/;
// Narrow a run: SIZES=phone412 ROUTES=/,/roster node scripts/shots.mjs out
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(",") : ALL_ROUTES;
const SIZES = Object.fromEntries(Object.entries(ALL_SIZES).filter(([k]) => !process.env.SIZES || process.env.SIZES.split(",").includes(k)));

// Things to open on a route, each screenshotted and checked like a page.
const OPEN = {
  "/": [
    // a logged game (tonight's "box score soon" row opens Game Pulse instead)
    ["story", async (p) => p.locator("main table tbody tr").filter({ hasNotText: /soon/i }).first().click()],
    ["box", async (p) => p.getByRole("button", { name: "Box score" }).first().click()],
    ["teampicker", async (p) => (await p.keyboard.press("Escape"), await p.waitForTimeout(500), p.getByRole("button", { name: /Celtics/ }).first().click())],
  ],
  "/news": [
    ["typepicker", async (p) => p.locator("main button:has-text('News type')").first().click()],
    ["injuries", async (p) => p.locator("[data-radix-popper-content-wrapper] button:has-text('Injuries')").first().click()],
  ],
  "/live": [["game", async (p) => p.locator("main button:has-text('Final')").first().click()]],
  "/ai": [
    ["typed", async (p) => p.locator("textarea").fill("Who has been better over the last ten games, the Celtics or the Knicks, and what changed in their rotations?")],
    ["models", async (p) => p.locator("main button:has-text('·')").first().click()],
    // the model list scrolls (a swipe on touch screens, the wheel otherwise) and fits on screen
    ["models-scrolled", async (p) => {
      const list = p.locator("[data-radix-popper-content-wrapper] .overscroll-contain").first();
      const box = await list.boundingBox();
      if (!box) throw new Error("model list isn't showing");
      const top = () => list.evaluate((e) => e.scrollTop);
      const touch = !!(await p.evaluate(() => navigator.maxTouchPoints));
      const [x, y] = [box.x + box.width / 2, box.y + box.height * 0.75];
      if (touch) {
        // a finger dragging up (Input.synthesizeScrollGesture's touch mode doesn't scroll here)
        const cdp = await p.context().newCDPSession(p);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let i = 1; i <= 10; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * Math.min(15, box.height / 20) }] });
          await p.waitForTimeout(16);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await p.mouse.move(x, y);
        await p.mouse.wheel(0, 300);
      }
      await p.waitForTimeout(400);
      const [scrolled, room] = [await top(), await list.evaluate((e) => `${e.scrollHeight}/${e.clientHeight}`)];
      if (!scrolled) throw new Error(`model list didn't scroll (content/visible ${room})`);
      const vh = p.viewportSize().height;
      if (box.y + box.height > vh + 1) throw new Error(`model list runs off screen (${Math.round(box.y + box.height)} > ${vh})`);
    }],
  ],
};

/** Layout problems in what's on screen now (pages and open dialogs). */
function findProblems() {
  const shown = (el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? "." + [...el.classList].slice(0, 3).join(".") : ""} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
  const skip = (el) => el.closest("svg, [aria-hidden='true'], .marquee, [data-shots-skip]");
  // With a dialog or popover open, only it is in front of the user.
  const layers = [...document.querySelectorAll("[role='dialog'], [data-radix-popper-content-wrapper]")];
  const front = layers.at(-1) ?? document.body;
  // Text in a bar or badge laid over the page (fixed, sticky, absolute) and the
  // text under it are separate layers.
  const layer = (el) => {
    for (let a = el; a; a = a.parentElement) if (["fixed", "sticky", "absolute"].includes(getComputedStyle(a).position)) return a;
    return null;
  };
  // Text scrolled out of its scroll box isn't on screen.
  const inView = (el, r) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowY;
      if (o === "auto" || o === "scroll") {
        const ar = a.getBoundingClientRect();
        return r.bottom > ar.top + 1 && r.top < ar.bottom - 1;
      }
    }
    return r.bottom > 0 && r.top < window.innerHeight;
  };
  const out = { sideways: [], clipped: [], overlap: [] };

  const sc = document.querySelector("main .scroll") ?? document.documentElement;
  if (sc.scrollWidth > sc.clientWidth + 1) out.sideways.push(`${sc.scrollWidth}>${sc.clientWidth}`);

  // Leaf text: elements whose own text nodes are non-empty.
  const leaves = [...front.querySelectorAll("*")].filter(
    (el) => !skip(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && shown(el) && inView(el, el.getBoundingClientRect()),
  );
  for (const el of leaves) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === "ellipsis") continue; // truncation on purpose
    const r = el.getBoundingClientRect();
    // clipped by an ancestor that hides overflow; text inside something that
    // scrolls sideways (a wide table) is reachable, so it's fine
    let scrolls = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === "auto" || acs.overflowX === "scroll") {
        scrolls = a.scrollWidth > a.clientWidth;
        break;
      }
      if (acs.overflowX === "hidden" || acs.overflowX === "clip") {
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 2 || r.left < ar.left - 2) out.clipped.push(label(el));
        break;
      }
    }
    if (!scrolls && r.right > window.innerWidth + 1 && cs.position !== "fixed") out.clipped.push(`${label(el)} off-screen`);
  }
  // text drawn on top of other text
  const rects = leaves.map((el) => [el, el.getBoundingClientRect(), layer(el)]);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [a, ra, la] = rects[i];
      const [b, rb, lb] = rects[j];
      if (a.contains(b) || b.contains(a) || la !== lb) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3 && w * h > 0.2 * Math.min(ra.width * ra.height, rb.width * rb.height)) out.overlap.push(`${label(a)} × ${label(b)}`);
    }
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, 6);
  return out;
}

const browser = await chromium.launch();
let problems = 0;
async function check(page, label, name) {
  await page.screenshot({ path: `${out}/${label}${name}.png` });
  const p = await page.evaluate(findProblems);
  const issues = [
    p.sideways.length && `scrolls sideways ${p.sideways[0]}`,
    p.clipped.length && `clipped: ${p.clipped.join(" | ")}`,
    p.overlap.length && `overlap: ${p.overlap.join(" | ")}`,
  ].filter(Boolean);
  if (issues.length) problems++;
  console.log(`${issues.length ? "✗" : "✓"} ${label} ${name}${issues.length ? "\n    " + issues.join("\n    ") : ""}`);
}

for (const [label, viewport] of Object.entries(SIZES)) {
  const phone = TOUCH.test(label);
  // The page scrolls inside the app shell, so "full page" means a tall window.
  if (process.env.FULL) viewport.height = 2400;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
  // LM Studio with a long model list, so the model picker has to scroll
  const models = { data: Array.from({ length: 40 }, (_, i) => ({ id: `sample-model-${String(i + 1).padStart(2, "0")}-instruct` })) };
  await ctx.route("http://localhost:1234/v1/models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(models) }));
  await ctx.route("**/api/proxy?*", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url");
    if (target?.startsWith("http://localhost:1234/v1/models")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(models) });
    const hit = target && sampleFor(target);
    if (hit) return route.fulfill({ status: 200, contentType: hit[0], body: hit[1] });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${label}] page error: ${e.message}`));
  for (const r of ROUTES) {
    await page.goto(`${base}/#${r}`);
    await page.waitForTimeout(r === ROUTES[0] ? 3500 : Number(process.env.WAIT ?? 2500));
    const name = r === "/" ? "_home" : r.replace(/\//g, "_");
    await check(page, label, name);
    for (const [what, open] of OPEN[r] ?? []) {
      try {
        await open(page);
        await page.waitForTimeout(1200);
        await check(page, label, `${name}__${what}`);
      } catch (e) {
        console.log(`? ${label} ${name}__${what}: couldn't open (${e.message.split("\n")[0]})`);
      }
    }
    await page.keyboard.press("Escape");
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `${problems} screen(s) with layout problems` : "no layout problems");
process.exit(0);
