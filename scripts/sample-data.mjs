// Synthetic payloads shaped like stats.nba.com / ESPN / RSS responses, for
// screenshots and layout checks without network access. Deterministic.

const TEAMS = [
  [1610612737, "ATL", 1], [1610612738, "BOS", 2], [1610612751, "BKN", 17], [1610612766, "CHA", 30],
  [1610612741, "CHI", 4], [1610612739, "CLE", 5], [1610612742, "DAL", 6], [1610612743, "DEN", 7],
  [1610612765, "DET", 8], [1610612744, "GSW", 9], [1610612745, "HOU", 10], [1610612754, "IND", 11],
  [1610612746, "LAC", 12], [1610612747, "LAL", 13], [1610612763, "MEM", 29], [1610612748, "MIA", 14],
  [1610612749, "MIL", 15], [1610612750, "MIN", 16], [1610612740, "NOP", 3], [1610612752, "NYK", 18],
  [1610612760, "OKC", 25], [1610612753, "ORL", 19], [1610612755, "PHI", 20], [1610612756, "PHX", 21],
  [1610612757, "POR", 22], [1610612758, "SAC", 23], [1610612759, "SAS", 24], [1610612761, "TOR", 28],
  [1610612762, "UTA", 26], [1610612764, "WAS", 27],
];
const EAST = new Set(["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"]);
const NAMES = ["Jayson Tatum", "Jaylen Brown", "Derrick White", "Kristaps Porzingis", "Payton Pritchard", "Al Horford", "Sam Hauser", "Luke Kornet", "Neemias Queta", "Xavier Tillman", "Jordan Walsh", "Baylor Scheierman", "Anton Watson"];
const POS = ["F", "G-F", "G", "C-F", "G", "C-F", "F", "C", "C", "F", "G-F", "G", "F"];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r1 = (x) => Math.round(x * 10) / 10;

function rs(headers, rows) {
  return { resultSets: [{ headers, rowSet: rows.map((r) => headers.map((h) => r[h] ?? null)) }] };
}

const qs = (url) => new URL(url).searchParams;

function standings() {
  const rows = TEAMS.map(([id, abbr], i) => {
    const w = 10 + ((i * 7) % 25);
    return { TeamID: id, Conference: EAST.has(abbr) ? "East" : "West", WINS: w, LOSSES: 40 - w, WinPCT: w / 40, strCurrentStreak: i % 2 ? "W 3" : "L 1", L10: `${5 + (i % 5)}-${5 - (i % 5)}`, HOME: `${Math.ceil(w / 2)}-${Math.floor((40 - w) / 2)}`, ROAD: `${Math.floor(w / 2)}-${Math.ceil((40 - w) / 2)}` };
  });
  for (const conf of ["East", "West"]) {
    const c = rows.filter((r) => r.Conference === conf).sort((a, b) => b.WINS - a.WINS);
    c.forEach((r, i) => {
      r.PlayoffRank = i + 1;
      r.ConferenceGamesBack = (c[0].WINS - r.WINS);
    });
  }
  return rs(["TeamID", "Conference", "PlayoffRank", "WINS", "LOSSES", "WinPCT", "ConferenceGamesBack", "strCurrentStreak", "L10", "HOME", "ROAD"], rows);
}

function teamStats(measure) {
  const headers = measure === "Advanced"
    ? ["TEAM_ID", "TEAM_NAME", "GP", "NET_RATING", "OFF_RATING", "DEF_RATING", "PACE", "TS_PCT", "EFG_PCT", "REB_PCT", "AST_TO"]
    : ["TEAM_ID", "TEAM_NAME", "GP", "PTS", "REB", "AST", "FG_PCT", "FG3_PCT", "STL", "BLK", "TOV"];
  return rs(headers, TEAMS.map(([id], i) => measure === "Advanced"
    ? { TEAM_ID: id, GP: 40, NET_RATING: r1(-10 + (i * 0.7)), OFF_RATING: r1(108 + (i % 9)), DEF_RATING: r1(110 - (i % 7)), PACE: r1(97 + (i % 6)), TS_PCT: 0.55 + (i % 8) / 100, EFG_PCT: 0.52 + (i % 7) / 100, REB_PCT: 0.48 + (i % 5) / 100, AST_TO: 1.6 + (i % 6) / 10 }
    : { TEAM_ID: id, GP: 40, PTS: r1(105 + (i % 14)), REB: r1(41 + (i % 6)), AST: r1(23 + (i % 8)), FG_PCT: 0.44 + (i % 6) / 100, FG3_PCT: 0.34 + (i % 5) / 100, STL: r1(6.5 + (i % 4) / 2), BLK: r1(4.2 + (i % 5) / 3), TOV: r1(12 + (i % 5) / 2) }));
}

function players(url) {
  const p = qs(url);
  const team = p.get("TeamID");
  const adv = p.get("MeasureType") === "Advanced";
  const rookie = p.get("PlayerExperience") === "Rookie";
  const pool = team ? NAMES.map((n, i) => [1628369 + i, n, Number(team), "BOS"]) : TEAMS.flatMap(([id, abbr], t) => NAMES.slice(0, 5).map((n, i) => [1600000 + t * 20 + i, `${n.split(" ")[0]} ${abbr}${i}`, id, abbr]));
  const rows = (rookie ? pool.slice(0, 20) : pool).map(([pid, name, tid, abbr], i) => {
    const m = Math.max(8, 36 - i * 2.2);
    return adv
      ? { PLAYER_ID: pid, PLAYER_NAME: name, TEAM_ID: tid, GP: 38, TS_PCT: 0.55 + (i % 7) / 100, EFG_PCT: 0.52 + (i % 6) / 100, USG_PCT: 0.3 - i / 100, AST_PCT: 0.2, AST_TO: 2.1, PIE: 0.14 - i / 200 }
      : { PLAYER_ID: pid, PLAYER_NAME: name, TEAM_ID: tid, TEAM_ABBREVIATION: abbr, GP: 40 - (i % 9), MIN: r1(m), PTS: r1(m * 0.75), REB: r1(m / 5), AST: r1(m / 8), STL: r1(m / 30), BLK: r1(m / 40), FG_PCT: 0.45 + (i % 6) / 100, FG3_PCT: 0.36, FT_PCT: 0.82, FGM: r1(m / 4), FG3M: r1(m / 12), FTM: r1(m / 10), FTA: r1(m / 8), OREB: 1.1, DREB: r1(m / 6), PF: 2.1, PFD: 3, TOV: 1.9, PLUS_MINUS: r1(6 - i) };
  });
  return rs(Object.keys(rows[0]), rows);
}

function roster(url) {
  const team = qs(url).get("TeamID");
  return rs(["TeamID", "PLAYER", "PLAYER_ID", "POSITION", "HOW_ACQUIRED"], NAMES.map((n, i) => ({ TeamID: team, PLAYER: n, PLAYER_ID: 1628369 + i, POSITION: POS[i], HOW_ACQUIRED: i === 3 ? "Traded from WAS on 06/22/23" : "Draft" })));
}

function dashboard() {
  return rs(["GP", "PTS", "REB", "AST", "STL", "BLK", "TOV", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "PLUS_MINUS"], [{ GP: 40, PTS: 4720, REB: 1810, AST: 1050, STL: 280, BLK: 230, TOV: 480, FGM: 1720, FGA: 3720, FG3M: 690, FG3A: 1860, FTM: 590, FTA: 720, PLUS_MINUS: 360 }]);
}

function history() {
  return rs(["YEAR", "WINS", "LOSSES", "WIN_PCT", "PTS", "REB", "AST", "FG_PCT", "FG3_PCT", "FT_PCT"], [2021, 2022, 2023, 2024, 2025, 2026].map((y, i) => ({ YEAR: `${y - 1}-${String(y % 100).padStart(2, "0")}`, WINS: 48 + i * 2, LOSSES: 34 - i * 2, WIN_PCT: (48 + i * 2) / 82, PTS: 112 + i, REB: 44, AST: 25 + i / 2, FG_PCT: 0.465, FG3_PCT: 0.37, FT_PCT: 0.81 })));
}

const OPP = ["LAL", "NYK", "MIA", "PHI", "MIL", "CLE", "DEN", "GSW", "PHX", "ORL"];

function gamelogs(url) {
  const p = qs(url);
  if (p.get("SeasonType") === "Playoffs") return rs(["GAME_ID", "GAME_DATE", "MATCHUP", "WL", "PTS"], []);
  const rows = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 30 - i));
    const pm = ((i * 13) % 25) - 9;
    return { GAME_ID: `00225${String(600 - i).padStart(5, "0")}`, Game_ID: `00225${String(600 - i).padStart(5, "0")}`, GAME_DATE: d.toISOString().slice(0, 10) + "T00:00:00", MATCHUP: `BOS ${i % 2 ? "@" : "vs."} ${OPP[i % OPP.length]}`, WL: pm > 0 ? "W" : "L", PTS: 110 + (i % 12), REB: 44, AST: 26, FG_PCT: 0.47, PLUS_MINUS: pm };
  });
  return rs(Object.keys(rows[0]), rows);
}

function leagueGamelog(url) {
  if (qs(url).get("SeasonType") === "Playoffs") return rs(["GAME_ID"], []);
  const rows = [];
  for (let g = 0; g < 60; g++) {
    const a = TEAMS[g % 30];
    const h = TEAMS[(g * 7 + 3) % 30];
    if (a === h) continue;
    const d = new Date(Date.UTC(2026, 0, 30 - Math.floor(g / 6))).toISOString().slice(0, 10);
    const gid = `00225${String(900 - g).padStart(5, "0")}`;
    rows.push({ GAME_ID: gid, GAME_DATE: d, TEAM_ID: a[0], TEAM_ABBREVIATION: a[1], MATCHUP: `${a[1]} @ ${h[1]}`, WL: g % 2 ? "W" : "L", PTS: 100 + (g % 20), MIN: g % 9 ? 240 : 265 });
    rows.push({ GAME_ID: gid, GAME_DATE: d, TEAM_ID: h[0], TEAM_ABBREVIATION: h[1], MATCHUP: `${h[1]} vs. ${a[1]}`, WL: g % 2 ? "L" : "W", PTS: 98 + ((g * 3) % 24), MIN: g % 9 ? 240 : 265 });
  }
  return rs(Object.keys(rows[0]), rows);
}

function playerGamelog() {
  const rows = Array.from({ length: 30 }, (_, i) => ({ GAME_DATE: `JAN ${String(30 - i).padStart(2, "0")}, 2026`, MATCHUP: `BOS ${i % 2 ? "@" : "vs."} ${OPP[i % OPP.length]}`, PTS: 20 + ((i * 7) % 18), REB: 6 + (i % 5), AST: 4 + (i % 4), MIN: 34 + (i % 5), FGA: 18 + (i % 6), FTA: 5 + (i % 4) }));
  return rs(Object.keys(rows[0]), rows);
}

function shots() {
  seed = 11;
  const rows = Array.from({ length: 400 }, () => {
    const t = rnd() * Math.PI;
    const d = rnd() < 0.35 ? rnd() * 60 : rnd() < 0.5 ? 100 + rnd() * 120 : 230 + rnd() * 30;
    return { LOC_X: Math.round(Math.cos(t) * d), LOC_Y: Math.round(Math.sin(t) * d) - 20, SHOT_MADE_FLAG: rnd() < (d < 60 ? 0.65 : 0.4) ? 1 : 0 };
  });
  return rs(["LOC_X", "LOC_Y", "SHOT_MADE_FLAG"], rows);
}

function bio(url) {
  const pid = qs(url).get("PlayerID");
  return rs(["DISPLAY_FIRST_LAST", "TEAM_ID", "HEIGHT", "WEIGHT", "BIRTHDATE", "COUNTRY", "SCHOOL", "POSITION", "JERSEY", "SEASON_EXP", "FROM_YEAR", "DRAFT_YEAR", "DRAFT_ROUND", "DRAFT_NUMBER"], [{ DISPLAY_FIRST_LAST: NAMES[(Number(pid) - 1628369) % NAMES.length] ?? "Player", TEAM_ID: 1610612738, HEIGHT: "6-8", WEIGHT: "210", BIRTHDATE: "1998-03-03T00:00:00", COUNTRY: "USA", SCHOOL: "Duke", POSITION: "Forward", JERSEY: "0", SEASON_EXP: 9, FROM_YEAR: "2017", DRAFT_YEAR: "2017", DRAFT_ROUND: "1", DRAFT_NUMBER: "3" }]);
}

const anthro = () => rs(["PLAYER_ID", "HEIGHT_WO_SHOES", "WEIGHT", "WINGSPAN", "STANDING_REACH", "HAND_LENGTH", "HAND_WIDTH", "BODY_FAT_PCT"], [{ PLAYER_ID: 1628369, HEIGHT_WO_SHOES: 79, WEIGHT: 204, WINGSPAN: 83.5, STANDING_REACH: 107, HAND_LENGTH: 9, HAND_WIDTH: 9.5, BODY_FAT_PCT: 5.4 }]);

// Overtime and 3-digit scores on both sides: the widest the scoreboard gets.
function v3Team(tri, tid, base, ot = 0) {
  return {
    teamTricode: tri, teamId: tid, score: base, periods: [28, 26, 30, base - 84 - ot, ...(ot ? [ot] : [])].map((s) => ({ score: s })),
    statistics: { points: base, fieldGoalsMade: 42, fieldGoalsAttempted: 88, threePointersMade: 15, threePointersAttempted: 40, freeThrowsMade: 14, freeThrowsAttempted: 18, reboundsOffensive: 10, reboundsDefensive: 34, reboundsTotal: 44, assists: 26, steals: 7, blocks: 5, turnovers: 12, foulsPersonal: 18, plusMinusPoints: 0 },
    players: NAMES.slice(0, 10).map((n, i) => ({ personId: 1628369 + i, firstName: n.split(" ")[0], familyName: n.split(" ")[1], position: i < 5 ? POS[i] : "", comment: "", statistics: { minutes: `${36 - i * 2}:00`, points: 28 - i * 2, fieldGoalsMade: 10 - i, fieldGoalsAttempted: 19 - i, threePointersMade: 3, threePointersAttempted: 8, freeThrowsMade: 4, freeThrowsAttempted: 5, reboundsOffensive: 1, reboundsDefensive: 6, reboundsTotal: 7, assists: 5, steals: 1, blocks: 1, turnovers: 2, foulsPersonal: 2, plusMinusPoints: 8 - i } })),
  };
}

const boxSummary = () => ({ boxScoreSummary: { homeTeam: v3Team("BOS", 1610612738, 125, 8), awayTeam: v3Team("LAL", 1610612747, 124, 7), arena: { arenaName: "TD Garden", arenaCity: "Boston" }, attendance: 19156, officials: [{ name: "Scott Foster" }, { name: "Tony Brothers" }], gameLabel: "", gameSubLabel: "", seriesText: "" } });
const boxTrad = () => ({ boxScoreTraditional: { homeTeam: v3Team("BOS", 1610612738, 125, 8), awayTeam: v3Team("LAL", 1610612747, 124, 7) } });

function espnTeam(abbr) {
  const t = TEAMS.find((x) => x[1] === abbr || (abbr === "GS" && x[1] === "GSW") || (abbr === "NY" && x[1] === "NYK"));
  return { id: String(t[2]), abbreviation: abbr, displayName: abbr, shortDisplayName: abbr, color: "333333", alternateColor: "cccccc" };
}

function scoreboard(url) {
  const date = qs(url).get("dates");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()).replaceAll("-", "");
  const pairs = [["LAL", "BOS", "post", 4, "0:00"], ["NY", "MIA", "post", 4, "0:00"], ["GS", "DEN", "pre", 0, ""], ["PHI", "MIL", "in", 2, "5:40"], ["OKC", "DAL", "pre", 0, ""]];
  const events = pairs.map(([a, h, state, period, clock], i) => ({
    id: String(401700100 + i),
    date: new Date(Date.now() + (state === "pre" ? (i + 2) * 3600e3 : -2 * 3600e3)).toISOString().replace(/\.\d+Z$/, "Z"),
    season: { type: 2, year: 2027 },
    status: { period, displayClock: clock, type: { state, shortDetail: state === "in" ? `${clock} - ${period}th` : state === "post" ? "Final" : "7:30 PM ET" } },
    competitions: [{ broadcasts: [{ names: ["ESPN"] }], competitors: [
      { homeAway: "home", score: state === "pre" ? "0" : String(98 + i * 3), team: espnTeam(h), records: [{ summary: "20-12" }] },
      { homeAway: "away", score: state === "pre" ? "0" : String(95 + i * 2), team: espnTeam(a), records: [{ summary: "18-14" }] },
    ] }],
  }));
  if (date && date !== today) return { day: { date }, season: { year: 2027 }, events: events.filter((e) => e.status.type.state === "pre").map((e) => ({ ...e, id: e.id + date.slice(-2) })) };
  return { day: { date: today }, season: { year: 2027 }, events };
}

function summary(url) {
  const plays = [];
  let h = 0, a = 0;
  seed = 5;
  for (let i = 0; i < 160; i++) {
    const period = 1 + Math.floor(i / 40);
    const rem = 720 - (i % 40) * 18;
    const home = rnd() < 0.52;
    const v = rnd() < 0.3 ? 3 : 2;
    if (home) h += v; else a += v;
    plays.push({ id: String(i), period: { number: period }, clock: { displayValue: `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, "0")}` }, homeScore: h, awayScore: a, scoringPlay: true, scoreValue: v, team: { id: home ? "2" : "13" }, text: `${home ? "Jayson Tatum" : "LeBron James"} makes ${v === 3 ? "26-foot three point jumper" : "driving layup"}` });
  }
  return {
    header: { competitions: [{ status: { period: 4, displayClock: "0:00", type: { state: "post", shortDetail: "Final" } }, competitors: [
      { homeAway: "home", score: String(h), team: { ...espnTeam("BOS"), color: "007a33" }, record: [{ summary: "28-12" }], linescores: [28, 26, 30, h - 84].map((x) => ({ displayValue: String(x) })) },
      { homeAway: "away", score: String(a), team: { ...espnTeam("LAL"), color: "552583" }, record: [{ summary: "24-16" }], linescores: [25, 27, 24, a - 76].map((x) => ({ displayValue: String(x) })) },
    ] }] },
    plays,
    winprobability: plays.map((p, i) => ({ playId: p.id, homeWinPercentage: Math.min(0.97, Math.max(0.03, 0.5 + (p.homeScore - p.awayScore) / 40 + i / 1000)) })),
    leaders: [["BOS", "Jayson Tatum"], ["LAL", "LeBron James"]].map(([abbr, n]) => ({ team: { abbreviation: abbr }, leaders: ["Points", "Rebounds", "Assists"].map((c, i) => ({ displayName: c, leaders: [{ displayValue: String(30 - i * 18), athlete: { displayName: n, headshot: { href: "" } } }] })) })),
    boxscore: {
      teams: ["home", "away"].map((ha) => ({ homeAway: ha, team: { abbreviation: ha === "home" ? "BOS" : "LAL" }, statistics: [["fieldGoalsMade-fieldGoalsAttempted", "42-88"], ["fieldGoalPct", "47.7"], ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "15-40"], ["threePointFieldGoalPct", "37.5"], ["freeThrowsMade-freeThrowsAttempted", "14-18"], ["totalRebounds", "44"], ["assists", "26"], ["steals", "7"], ["blocks", "5"], ["totalTurnovers", "12"]].map(([name, displayValue]) => ({ name, displayValue })) })),
      players: [["2", "BOS"], ["13", "LAL"]].map(([id, abbr]) => ({ team: { id, abbreviation: abbr }, statistics: [{ keys: ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "freeThrowsMade-freeThrowsAttempted", "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "fouls", "plusMinus"], totals: ["", "118", "42-88", "15-40", "14-18", "10", "34", "44", "26", "7", "5", "12", "18", ""], athletes: NAMES.slice(0, 9).map((n, i) => ({ athlete: { id: String(i), displayName: n, position: { abbreviation: POS[i] } }, starter: i < 5, stats: [String(36 - i * 2), String(28 - i * 2), "10-19", "3-8", "4-5", "1", "6", "7", "5", "1", "1", "2", "2", `+${8 - i}`] })) }] })),
    },
    gameInfo: { venue: { fullName: "TD Garden" } },
  };
}

function espnNews() {
  return { articles: Array.from({ length: 14 }, (_, i) => ({ id: 1000 + i, headline: ["Tatum drops 41 as Celtics roll past Lakers", "Inside the Celtics' defensive turnaround", "Trade deadline primer: buyers and sellers", "Highlights: Brown's poster dunk", "Mazzulla on the rotation tightening"][i % 5] + (i > 4 ? ` (${i})` : ""), description: "A look at what's working, what isn't, and what comes next for the team as the season heads toward the break.", published: new Date(Date.now() - i * 3600e3).toISOString(), byline: "Staff", type: i % 5 === 3 ? "Media" : "Story", links: { web: { href: "https://www.espn.com/nba/story/_/id/1" } }, images: [{ url: "" }], categories: [{ type: "team", description: "Boston Celtics" }] })) };
}

function injuries() {
  return { injuries: [
    { id: "2", displayName: "Boston Celtics", injuries: [{ athlete: { displayName: "Kristaps Porzingis", position: { abbreviation: "C" } }, status: "Out", details: { side: "Left", type: "Ankle", detail: "Sprain", returnDate: "2026-11-10" }, shortComment: "Porzingis (ankle) will miss at least two weeks after an MRI on Monday confirmed a sprain, coach Joe Mazzulla told reporters before Wednesday's practice, and he'll be re-evaluated then.", date: "2026-10-26" }] },
    { id: "13", displayName: "Los Angeles Lakers", injuries: [{ athlete: { displayName: "Anthony Davis", position: { abbreviation: "F" } }, status: "Day-To-Day", details: { type: "Knee" }, shortComment: "Questionable for Friday.", date: "2026-10-26" }] },
  ] };
}

function rss(source) {
  const items = Array.from({ length: 8 }, (_, i) => `<item><title>${source} ${["Celtics", "Knicks", "Lakers", "Heat"][i % 4]} report ${i + 1}</title><link>https://example.com/${encodeURIComponent(source)}/${i}</link><guid>${source}-${i}</guid><description>&lt;p&gt;Notes and analysis from around the league.&lt;/p&gt;</description><pubDate>${new Date(Date.now() - i * 5400e3).toUTCString()}</pubDate></item>`).join("");
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
}

/** [contentType, body] for a proxied URL, or null. */
export function sampleFor(url) {
  const u = new URL(url);
  const ep = u.pathname.split("/").pop();
  if (u.hostname === "stats.nba.com") {
    const map = {
      leaguestandingsv3: standings, leaguedashteamstats: () => teamStats(qs(url).get("MeasureType")),
      leaguedashplayerstats: players, commonteamroster: roster, teamdashboardbygeneralsplits: dashboard,
      teamyearbyyearstats: history, teamgamelogs: gamelogs, teamgamelog: gamelogs, leaguegamelog: leagueGamelog,
      playergamelog: playerGamelog, shotchartdetail: shots, commonplayerinfo: bio, draftcombineplayeranthro: anthro,
      boxscoresummaryv3: boxSummary, boxscoretraditionalv3: boxTrad,
    };
    return map[ep] ? ["application/json", JSON.stringify(map[ep](url))] : null;
  }
  if (u.hostname === "site.api.espn.com") {
    if (ep === "scoreboard") return ["application/json", JSON.stringify(scoreboard(url))];
    if (ep === "summary") return ["application/json", JSON.stringify(summary(url))];
    if (ep === "news") return ["application/json", JSON.stringify(espnNews())];
    if (ep === "injuries") return ["application/json", JSON.stringify(injuries())];
  }
  const feeds = { "www.espn.com": "ESPN", "www.cbssports.com": "CBS Sports", "sports.yahoo.com": "Yahoo Sports", "www.hoopsrumors.com": "Hoops Rumors", "basketball.realgm.com": "RealGM" };
  if (feeds[u.hostname]) return ["application/rss+xml", rss(feeds[u.hostname])];
  return null;
}
