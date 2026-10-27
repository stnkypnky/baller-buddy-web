export type SeasonType = "regular" | "playoffs" | "full";

export interface TeamColors {
  primary: string;
  hover: string;
  dark_bg: string;
  panel: string;
  banner: string;
}

export interface Team {
  id: number;
  name: string;
  abbr: string;
  city: string;
  nickname: string;
  conference: "East" | "West";
  espn_id: number;
  espn_abbr: string;
  colors: TeamColors;
}

export interface Meta {
  season: string;
  seasons: string[];
  season_types: { slug: SeasonType; label: string }[];
  default_team: string;
  teams: Team[];
}

export interface Health {
  ok: boolean;
  ready: boolean;
  step: string;
  done: number;
  total: number;
  season: string;
}

export interface Standing {
  wins: number;
  losses: number;
  win_pct: number;
  conf_rank: number;
  conference: string;
  home: string;
  road: string;
  streak: string;
  last10: string;
  gb: number;
}

export interface StandingRow {
  team_id: number;
  team_name: string;
  conference: string;
  rank: number;
  wins: number;
  losses: number;
  win_pct: number;
  gb: number;
  streak: string;
  last10: string;
  home: string;
  road: string;
}

export interface Dashboard {
  gp: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fg_pct: number;
  fg3_pct: number;
  ft_pct: number;
  plus_minus: number;
}

export interface TeamGame {
  game_id: string;
  iso: string;
  date: string;
  matchup: string;
  wl: string;
  pts: number;
  reb: number;
  ast: number;
  fg_pct: number;
  plus_minus: number;
}

export interface EspnSide {
  espn_id: number;
  app_name: string;
  abbr: string;
  short: string;
  score: string;
  record: string;
}

export interface UpcomingGame {
  id: string;
  date_utc: string;
  stype: number;
  home: EspnSide;
  away: EspnSide;
}

export interface Overview {
  team_id: number;
  team_name: string;
  season: string;
  standings: Standing | Record<string, never>;
  dash: Record<SeasonType, Dashboard | Record<string, never>>;
  games: { regular: TeamGame[]; playoffs: TeamGame[] };
  next_game: UpcomingGame | null;
}

export interface Player {
  pid: number;
  name: string;
  pos: string;
  gp: number;
  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fg_pct: number;
  fg3_pct: number;
  plus_minus: number;
  /** How nba.com says they joined, e.g. "Traded from SAC on 02/08/22"; may be "". */
  acquired?: string;
  /** ESPN injury report entry; current season only (roster endpoint). */
  injury?: PlayerInjury | null;
  /** Set when the player sat out an entire finished season. */
  absence?: PlayerAbsence | null;
}

export interface PlayerInjury {
  status: string;
  injury: string;
  return_date: string;
  comment: string;
}

/** Games played the seasons either side of a missed one (null = no data yet). */
export interface PlayerAbsence {
  prev: { season: string; gp: number; team: string } | null;
  next: { season: string; gp: number; team: string } | null;
}

/** A web snippet explaining a missed season. */
export interface AbsenceNote {
  text: string;
  title: string;
  source: string;
  url: string;
}

export interface HistoryRow {
  season: string;
  wins: number;
  losses: number;
  win_pct: number;
  pts: number;
  reb: number;
  ast: number;
  fg_pct: number;
  fg3_pct: number;
  ft_pct: number;
}

export interface PlayerProfile {
  player: Player | null;
  absence_note: AbsenceNote | null;
  team_id: number;
  team_name: string;
  season: string;
  advanced: Partial<Record<"ts" | "efg" | "usg" | "ast_pct" | "ast_to" | "pie", number>>;
  per36: Partial<Record<"pts" | "reb" | "ast", number>>;
  shots: { x: number[]; y: number[]; made: number[] };
  games: { date: string; matchup: string; pts: number; reb: number; ast: number; min: number; ts: number }[];
  bio: PlayerBio | null;
  anthro: Anthro | null;
}

/** nba.com bio; height in inches, birthdate as YYYY-MM-DD. */
export interface PlayerBio {
  name: string;
  team_id: number;
  height_in: number | null;
  weight_lb: number | null;
  birthdate: string | null;
  country: string;
  school: string;
  position: string;
  jersey: string;
  season_exp: number;
  from_year: number | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_pick: number | null;
}

/** Draft-combine measurements in inches / lb / %, taken before the player's draft. */
export interface Anthro {
  year: number;
  height_no_shoes: number | null;
  weight: number | null;
  wingspan: number | null;
  standing_reach: number | null;
  hand_length: number | null;
  hand_width: number | null;
  body_fat: number | null;
}

export interface PlayerLeader {
  pid: number;
  name: string;
  team_id: number;
  team_abbr: string;
  gp: number;
  value: number;
}

export interface PlayerLeaders {
  season: string;
  min_games: number;
  categories: {
    label: string;
    field: string;
    format: string;
    definition: string;
    min_per_game: { field: string; value: number } | null;
    leaders: PlayerLeader[];
  }[];
}

export interface LeaderCategory {
  label: string;
  measure: "Base" | "Advanced";
  field: string;
  higher_is_better: boolean;
  format: string;
  definition: string;
}

export interface Leaders {
  categories: LeaderCategory[];
  Base: (Record<string, number> & { team_id: number; team_name: string })[];
  Advanced: (Record<string, number> & { team_id: number; team_name: string })[];
}

export interface ScoreGame {
  game_id: string;
  date: string;
  ot: boolean;
  home: { team_id: number; abbr: string; pts: number };
  away: { team_id: number; abbr: string; pts: number };
}

export interface Scores {
  season: string;
  regular: ScoreGame[];
  playoffs: ScoreGame[];
  upcoming: UpcomingGame[];
}

export interface StoryPlayer {
  pid: number;
  name: string;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  pm: number;
  gmsc: number;
}

export interface StorySide {
  abbr?: string;
  team_id?: number;
  score?: number;
  periods?: number[];
  players?: StoryPlayer[];
}

export interface GameStory {
  home: StorySide;
  away: StorySide;
  arena?: string;
  attendance?: number;
  officials?: string[];
  label?: string;
  series?: string;
}

export interface CompareSide {
  team_id: number;
  team_name: string;
  standings: Standing | Record<string, never>;
  dash: Dashboard | Record<string, never>;
  record: [number, number] | null;
}

export interface Compare {
  season: string;
  season_type: string;
  a: CompareSide;
  b: CompareSide;
  series: {
    game_id: string;
    date: string;
    home: boolean;
    pts: number;
    opp_pts: number | null;
    summary: string;
    win: boolean;
    po: boolean;
  }[];
  series_record: [number, number];
  context: string;
}

export interface LiveGame {
  id: string;
  state: "pre" | "in" | "post";
  status_text: string;
  date_utc: string;
  period: number;
  clock: string;
  broadcast: string;
  home: EspnSide;
  away: EspnSide;
}

export interface LiveBoard {
  date: string;
  season_year: number | null;
  games: LiveGame[];
}

/** Counting stats in a box score row (pm = plus/minus). */
export interface BoxStats {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pm: number;
}

export interface BoxPlayer extends BoxStats {
  /** nba.com id; 0 for ESPN boxes, which carry espn_id instead. */
  pid: number;
  espn_id?: string;
  name: string;
  pos: string;
  starter: boolean;
  min: string;
  /** Why he sat ("DNP - Coach's Decision"); blank if he played. */
  dnp: string;
}

export interface BoxSide {
  abbr: string;
  team_id?: number;
  score?: number;
  players: BoxPlayer[];
  totals: BoxStats;
}

/** A full box score: nba.com (finished games) or ESPN (live or final). */
export interface GameBox {
  source: "nba" | "espn";
  final: boolean;
  state?: string;
  away?: BoxSide;
  home?: BoxSide;
}

export interface NewsArticle {
  headline: string;
  description: string;
  published: string;
  byline: string;
  link: string;
}
