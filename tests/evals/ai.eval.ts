/** Accuracy evals: real questions through the whole chat pipeline (grounding,
 *  tools, fact-check) against a real model, in a world where every fact is
 *  known (./world.ts). Each answer is scored on what it must say and what it
 *  must never say; the report compares models.
 *
 *    EVAL_BASE_URL=https://openrouter.ai/api/v1 EVAL_KEY=sk-... \
 *    EVAL_MODELS=openai/gpt-oss-20b,openai/gpt-oss-120b npm run eval
 *
 *  Any OpenAI-compatible endpoint works (OpenRouter, Groq, LM Studio,
 *  Ollama's /v1). Answers are written to evals-out/ for reading. */

import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Cache } from "../../web/src/backend/cache";
import * as keys from "../../web/src/backend/llm/keys";
import * as router from "../../web/src/backend/llm/router";
import * as data from "../../web/src/backend/nba/data";
import * as settings from "../../web/src/backend/settings";
import { FINALS, serveWorld } from "./world";

const BOS = 1610612738;
const BASE = process.env.EVAL_BASE_URL ?? "";
const MODELS = (process.env.EVAL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = process.env.EVAL_CASES; // run a few: EVAL_CASES=yesterday,typo

interface Case {
  id: string;
  q: string;
  /** Earlier turns, for follow-ups. */
  before?: { role: string; content: string }[];
  /** Every pattern must appear. */
  must?: RegExp[];
  /** None may appear. */
  never?: RegExp[];
}

const REAL_SCORES = new Set(FINALS.map(([, , a, , h]) => [a, h].sort((x, y) => y - x).join("-")));

const CASES: Case[] = [
  {
    id: "yesterday",
    q: "How did the games turn out yesterday",
    must: [/101.{1,3}99/, /118.{1,3}112/, /125.{1,3}121/],
    never: [/Hawks|Atlanta/, /Celtics (beat|won|lost|fell|edged|topped)/i],
  },
  { id: "typo", q: "how did the games turn out yesterdat", must: [/101.{1,3}99/, /118.{1,3}112/, /125.{1,3}121/] },
  {
    id: "celtics-last-night",
    q: "How did the Celtics do last night?",
    must: [/\b(didn'?t|did not|no game|weren'?t|off|idle|rest)/i],
    never: [/Celtics (beat|won|lost|fell|edged|topped)/i],
  },
  { id: "top-scorer", q: "Who was the top scorer in the Lakers game yesterday?", must: [/Doncic|Dončić/, /35/] },
  { id: "best-to-watch", q: "Which game from yesterday was the best one to watch?", must: [/Nuggets|Warriors|Denver|Golden State/, /OT|overtime/i] },
  { id: "pg-team", q: "What team does Paul George play for?", must: [/Celtics|Boston/], never: [/Clippers|76ers|Sixers|Pacers|Thunder/] },
  { id: "leading-scorer", q: "Who's our leading scorer?", must: [/Tatum/, /27/] },
  { id: "injury", q: "Is Porzingis playing tonight?", must: [/\bout\b|won'?t play|not play|sidelined|injur/i, /ankle/i] },
  { id: "tonight", q: "Who wins tonight, Celtics or Hawks?", must: [/6\.5/, /Celtics|Boston/], never: [/Hawks (beat|won)/] },
  { id: "standings", q: "Where do the Celtics stand in the East?", must: [/(1st|first|#1|No\. 1|top)/i, /4-1/] },
  {
    id: "follow-up",
    q: "and who led them in scoring?",
    before: [
      { role: "user", content: "How did the Knicks do yesterday?" },
      { role: "assistant", content: "The Knicks beat the Bulls 101-99." },
    ],
    must: [/Brunson/, /33/],
  },
];

/** Scores in an answer that no game in the world had. */
function inventedScores(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/\b(19|20)\d\d(?:-\d\d)?\b/g, " ").matchAll(/(?<![\d.])(\d{2,3})\s*(?:-|–|—|to)\s*(\d{2,3})(?![\d.%])/g)) {
    const [a, b] = [+m[1], +m[2]];
    if (a >= 70 && b >= 70 && a <= 200 && b <= 200 && !REAL_SCORES.has([a, b].sort((x, y) => y - x).join("-"))) out.push(m[0]);
  }
  return out;
}

interface Result {
  model: string;
  id: string;
  pass: boolean;
  failures: string[];
  answer: string;
  factcheck: any;
  tools: string[];
  ms: number;
}
const results: Result[] = [];

async function ask(model: string, c: Case): Promise<Result> {
  serveWorld();
  data.clearScoreboards();
  if (process.env.EVAL_KEY) await keys.setKey("custom", process.env.EVAL_KEY);
  await settings.update("ai", { custom_base_url: BASE, provider: "custom", model, fallbacks: [], no_tools: [], factcheck: true });
  const t0 = Date.now();
  let answer = "";
  let factcheck: any = null;
  const tools: string[] = [];
  let error = "";
  const req: router.ChatRequest = { mode: "chat", team_id: BOS, messages: [...(c.before ?? []), { role: "user", content: c.q }] };
  for await (const e of router.chatEvents(req, new Cache({ persist: false }))) {
    if (e.event === "token") answer += e.data.text ?? "";
    else if (e.event === "revision") answer = "";
    else if (e.event === "revision_restore") answer = e.data.text ?? answer;
    else if (e.event === "factcheck") factcheck = e.data;
    else if (e.event === "tool_call") tools.push(e.data.name ?? "?");
    else if (e.event === "error") error = e.data.message;
  }
  const failures: string[] = [];
  if (error) failures.push(`error: ${error}`);
  for (const re of c.must ?? []) if (!re.test(answer)) failures.push(`missing ${re}`);
  for (const re of c.never ?? []) if (re.test(answer)) failures.push(`said ${re}`);
  const fake = inventedScores(answer);
  if (fake.length) failures.push(`invented scores: ${fake.join(", ")}`);
  if (factcheck?.unresolved) failures.push(`fact-check couldn't confirm: ${factcheck.names.join(", ")}`);
  return { model, id: c.id, pass: !failures.length, failures, answer, factcheck, tools, ms: Date.now() - t0 };
}

describe.skipIf(!BASE || !MODELS.length)("AI accuracy", () => {
  for (const model of MODELS) {
    for (const c of CASES.filter((c) => !ONLY || ONLY.split(",").includes(c.id))) {
      it(`${model} · ${c.id}`, async () => {
        const r = await ask(model, c);
        results.push(r);
        // the report carries the failures; the run itself only fails on a broken pipeline
        expect(r.failures.filter((f) => f.startsWith("error:"))).toEqual([]);
      });
    }
  }

  afterAll(async () => {
    if (!results.length) return;
    mkdirSync("evals-out", { recursive: true });
    const lines = ["# AI accuracy", "", "| model | passed | avg time |", "|---|---|---|"];
    for (const m of MODELS) {
      const rs = results.filter((r) => r.model === m);
      lines.push(`| ${m} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${(rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000).toFixed(1)}s |`);
    }
    for (const r of results) {
      lines.push("", `## ${r.pass ? "✓" : "✗"} ${r.model} · ${r.id}`, "");
      if (r.failures.length) lines.push(...r.failures.map((f) => `- ${f}`), "");
      lines.push(`tools: ${r.tools.join(", ") || "none"} · fact-check: ${JSON.stringify(r.factcheck)} · ${(r.ms / 1000).toFixed(1)}s`, "", "```", r.answer.trim(), "```");
    }
    const file = `evals-out/report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    writeFileSync(file, lines.join("\n"));
    console.log(lines.slice(0, 4 + MODELS.length).join("\n") + `\n\nfull report: ${file}`);
  });
});
