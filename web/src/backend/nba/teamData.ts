/** Static team data: nba.com ids and tricodes, ESPN ids and codes, colors.
 *  Generated from the desktop app's nba_api static teams + team_colors.py. */

export interface TeamColors { primary: string; hover: string; dark_bg: string; panel: string; banner: string }

export interface Team {
  id: number;
  full_name: string;
  abbreviation: string;
  city: string;
  nickname: string;
  east: boolean;
  espn_id: number;
  espn_abbr: string;
}

export const TEAMS: Team[] = [
  {"id": 1610612737, "full_name": "Atlanta Hawks", "abbreviation": "ATL", "city": "Atlanta", "nickname": "Hawks", "east": true, "espn_id": 1, "espn_abbr": "atl"},
  {"id": 1610612738, "full_name": "Boston Celtics", "abbreviation": "BOS", "city": "Boston", "nickname": "Celtics", "east": true, "espn_id": 2, "espn_abbr": "bos"},
  {"id": 1610612751, "full_name": "Brooklyn Nets", "abbreviation": "BKN", "city": "Brooklyn", "nickname": "Nets", "east": true, "espn_id": 17, "espn_abbr": "bkn"},
  {"id": 1610612766, "full_name": "Charlotte Hornets", "abbreviation": "CHA", "city": "Charlotte", "nickname": "Hornets", "east": true, "espn_id": 30, "espn_abbr": "cha"},
  {"id": 1610612741, "full_name": "Chicago Bulls", "abbreviation": "CHI", "city": "Chicago", "nickname": "Bulls", "east": true, "espn_id": 4, "espn_abbr": "chi"},
  {"id": 1610612739, "full_name": "Cleveland Cavaliers", "abbreviation": "CLE", "city": "Cleveland", "nickname": "Cavaliers", "east": true, "espn_id": 5, "espn_abbr": "cle"},
  {"id": 1610612742, "full_name": "Dallas Mavericks", "abbreviation": "DAL", "city": "Dallas", "nickname": "Mavericks", "east": false, "espn_id": 6, "espn_abbr": "dal"},
  {"id": 1610612743, "full_name": "Denver Nuggets", "abbreviation": "DEN", "city": "Denver", "nickname": "Nuggets", "east": false, "espn_id": 7, "espn_abbr": "den"},
  {"id": 1610612765, "full_name": "Detroit Pistons", "abbreviation": "DET", "city": "Detroit", "nickname": "Pistons", "east": true, "espn_id": 8, "espn_abbr": "det"},
  {"id": 1610612744, "full_name": "Golden State Warriors", "abbreviation": "GSW", "city": "Golden State", "nickname": "Warriors", "east": false, "espn_id": 9, "espn_abbr": "gs"},
  {"id": 1610612745, "full_name": "Houston Rockets", "abbreviation": "HOU", "city": "Houston", "nickname": "Rockets", "east": false, "espn_id": 10, "espn_abbr": "hou"},
  {"id": 1610612754, "full_name": "Indiana Pacers", "abbreviation": "IND", "city": "Indiana", "nickname": "Pacers", "east": true, "espn_id": 11, "espn_abbr": "ind"},
  {"id": 1610612746, "full_name": "Los Angeles Clippers", "abbreviation": "LAC", "city": "Los Angeles", "nickname": "Clippers", "east": false, "espn_id": 12, "espn_abbr": "lac"},
  {"id": 1610612747, "full_name": "Los Angeles Lakers", "abbreviation": "LAL", "city": "Los Angeles", "nickname": "Lakers", "east": false, "espn_id": 13, "espn_abbr": "lal"},
  {"id": 1610612763, "full_name": "Memphis Grizzlies", "abbreviation": "MEM", "city": "Memphis", "nickname": "Grizzlies", "east": false, "espn_id": 29, "espn_abbr": "mem"},
  {"id": 1610612748, "full_name": "Miami Heat", "abbreviation": "MIA", "city": "Miami", "nickname": "Heat", "east": true, "espn_id": 14, "espn_abbr": "mia"},
  {"id": 1610612749, "full_name": "Milwaukee Bucks", "abbreviation": "MIL", "city": "Milwaukee", "nickname": "Bucks", "east": true, "espn_id": 15, "espn_abbr": "mil"},
  {"id": 1610612750, "full_name": "Minnesota Timberwolves", "abbreviation": "MIN", "city": "Minnesota", "nickname": "Timberwolves", "east": false, "espn_id": 16, "espn_abbr": "min"},
  {"id": 1610612740, "full_name": "New Orleans Pelicans", "abbreviation": "NOP", "city": "New Orleans", "nickname": "Pelicans", "east": false, "espn_id": 3, "espn_abbr": "no"},
  {"id": 1610612752, "full_name": "New York Knicks", "abbreviation": "NYK", "city": "New York", "nickname": "Knicks", "east": true, "espn_id": 18, "espn_abbr": "ny"},
  {"id": 1610612760, "full_name": "Oklahoma City Thunder", "abbreviation": "OKC", "city": "Oklahoma City", "nickname": "Thunder", "east": false, "espn_id": 25, "espn_abbr": "okc"},
  {"id": 1610612753, "full_name": "Orlando Magic", "abbreviation": "ORL", "city": "Orlando", "nickname": "Magic", "east": true, "espn_id": 19, "espn_abbr": "orl"},
  {"id": 1610612755, "full_name": "Philadelphia 76ers", "abbreviation": "PHI", "city": "Philadelphia", "nickname": "76ers", "east": true, "espn_id": 20, "espn_abbr": "phi"},
  {"id": 1610612756, "full_name": "Phoenix Suns", "abbreviation": "PHX", "city": "Phoenix", "nickname": "Suns", "east": false, "espn_id": 21, "espn_abbr": "phx"},
  {"id": 1610612757, "full_name": "Portland Trail Blazers", "abbreviation": "POR", "city": "Portland", "nickname": "Trail Blazers", "east": false, "espn_id": 22, "espn_abbr": "por"},
  {"id": 1610612758, "full_name": "Sacramento Kings", "abbreviation": "SAC", "city": "Sacramento", "nickname": "Kings", "east": false, "espn_id": 23, "espn_abbr": "sac"},
  {"id": 1610612759, "full_name": "San Antonio Spurs", "abbreviation": "SAS", "city": "San Antonio", "nickname": "Spurs", "east": false, "espn_id": 24, "espn_abbr": "sa"},
  {"id": 1610612761, "full_name": "Toronto Raptors", "abbreviation": "TOR", "city": "Toronto", "nickname": "Raptors", "east": true, "espn_id": 28, "espn_abbr": "tor"},
  {"id": 1610612762, "full_name": "Utah Jazz", "abbreviation": "UTA", "city": "Utah", "nickname": "Jazz", "east": false, "espn_id": 26, "espn_abbr": "utah"},
  {"id": 1610612764, "full_name": "Washington Wizards", "abbreviation": "WAS", "city": "Washington", "nickname": "Wizards", "east": true, "espn_id": 27, "espn_abbr": "wsh"},
];

export const TEAM_COLORS: Record<string, TeamColors> = {
  "Atlanta Hawks": {
    "primary": "#E03A3E",
    "hover": "#b52c30",
    "dark_bg": "#120506",
    "panel": "#1c0708",
    "banner": "#240a0a"
  },
  "Boston Celtics": {
    "primary": "#007A33",
    "hover": "#005a22",
    "dark_bg": "#0a1a0f",
    "panel": "#0f1f13",
    "banner": "#0c2a16"
  },
  "Brooklyn Nets": {
    "primary": "#CCCCCC",
    "hover": "#999999",
    "dark_bg": "#0a0a0a",
    "panel": "#141414",
    "banner": "#1c1c1c"
  },
  "Charlotte Hornets": {
    "primary": "#00788C",
    "hover": "#005a6a",
    "dark_bg": "#050c0e",
    "panel": "#0a1416",
    "banner": "#0e1c1f"
  },
  "Chicago Bulls": {
    "primary": "#CE1141",
    "hover": "#a00d32",
    "dark_bg": "#130408",
    "panel": "#1c0610",
    "banner": "#240818"
  },
  "Cleveland Cavaliers": {
    "primary": "#FDBB30",
    "hover": "#c99500",
    "dark_bg": "#120905",
    "panel": "#1c1208",
    "banner": "#241808"
  },
  "Dallas Mavericks": {
    "primary": "#00538C",
    "hover": "#003d6a",
    "dark_bg": "#050c12",
    "panel": "#0a1420",
    "banner": "#0c1c2a"
  },
  "Denver Nuggets": {
    "primary": "#FEC524",
    "hover": "#cc9c00",
    "dark_bg": "#12100a",
    "panel": "#1c1a0a",
    "banner": "#22200e"
  },
  "Detroit Pistons": {
    "primary": "#C8102E",
    "hover": "#9c0c24",
    "dark_bg": "#120408",
    "panel": "#1c060c",
    "banner": "#22080e"
  },
  "Golden State Warriors": {
    "primary": "#FFC72C",
    "hover": "#cc9e00",
    "dark_bg": "#100e08",
    "panel": "#1a160a",
    "banner": "#201c0e"
  },
  "Houston Rockets": {
    "primary": "#CE1141",
    "hover": "#a00d32",
    "dark_bg": "#130408",
    "panel": "#1c0610",
    "banner": "#240818"
  },
  "Indiana Pacers": {
    "primary": "#FDBB30",
    "hover": "#c99500",
    "dark_bg": "#100d08",
    "panel": "#1a1408",
    "banner": "#201a0e"
  },
  "Los Angeles Clippers": {
    "primary": "#C8102E",
    "hover": "#9c0c24",
    "dark_bg": "#120408",
    "panel": "#1c060c",
    "banner": "#22080e"
  },
  "Los Angeles Lakers": {
    "primary": "#FDB927",
    "hover": "#c9940a",
    "dark_bg": "#0d0914",
    "panel": "#160e22",
    "banner": "#1e1430"
  },
  "Memphis Grizzlies": {
    "primary": "#5D76A9",
    "hover": "#4a5e88",
    "dark_bg": "#07080e",
    "panel": "#0c1018",
    "banner": "#121820"
  },
  "Miami Heat": {
    "primary": "#F9A01B",
    "hover": "#c97c00",
    "dark_bg": "#120508",
    "panel": "#1c080e",
    "banner": "#240c14"
  },
  "Milwaukee Bucks": {
    "primary": "#EEE1C6",
    "hover": "#c4b898",
    "dark_bg": "#060d08",
    "panel": "#0a1410",
    "banner": "#0e1c14"
  },
  "Minnesota Timberwolves": {
    "primary": "#4DC8F6",
    "hover": "#2aa8d8",
    "dark_bg": "#05080e",
    "panel": "#0a101a",
    "banner": "#0e1824"
  },
  "New Orleans Pelicans": {
    "primary": "#C8AA74",
    "hover": "#a88a55",
    "dark_bg": "#0a0a0c",
    "panel": "#0e1016",
    "banner": "#14161e"
  },
  "New York Knicks": {
    "primary": "#F58426",
    "hover": "#c96810",
    "dark_bg": "#120a06",
    "panel": "#1c1008",
    "banner": "#22160a"
  },
  "Oklahoma City Thunder": {
    "primary": "#EF3B24",
    "hover": "#c02c18",
    "dark_bg": "#130608",
    "panel": "#1c0a0a",
    "banner": "#22100c"
  },
  "Orlando Magic": {
    "primary": "#0077C0",
    "hover": "#005a96",
    "dark_bg": "#050c14",
    "panel": "#0a1420",
    "banner": "#0e1c2c"
  },
  "Philadelphia 76ers": {
    "primary": "#ED174C",
    "hover": "#bc1238",
    "dark_bg": "#130508",
    "panel": "#1c080e",
    "banner": "#220c14"
  },
  "Phoenix Suns": {
    "primary": "#E56020",
    "hover": "#b84c14",
    "dark_bg": "#130804",
    "panel": "#1c100a",
    "banner": "#22160c"
  },
  "Portland Trail Blazers": {
    "primary": "#E03A3E",
    "hover": "#b52c30",
    "dark_bg": "#120506",
    "panel": "#1c0708",
    "banner": "#240a0a"
  },
  "Sacramento Kings": {
    "primary": "#9B65CF",
    "hover": "#7a4daa",
    "dark_bg": "#0d0812",
    "panel": "#140e1c",
    "banner": "#1c1226"
  },
  "San Antonio Spurs": {
    "primary": "#C4CED4",
    "hover": "#9aaab2",
    "dark_bg": "#090a0a",
    "panel": "#121416",
    "banner": "#1a1e20"
  },
  "Toronto Raptors": {
    "primary": "#CE1141",
    "hover": "#a00d32",
    "dark_bg": "#130408",
    "panel": "#1c0610",
    "banner": "#240818"
  },
  "Utah Jazz": {
    "primary": "#F9A01B",
    "hover": "#c97c00",
    "dark_bg": "#060c10",
    "panel": "#0c1418",
    "banner": "#101c22"
  },
  "Washington Wizards": {
    "primary": "#E31837",
    "hover": "#b51228",
    "dark_bg": "#130407",
    "panel": "#1c070e",
    "banner": "#220c14"
  }
};

export const DEFAULT_COLORS: TeamColors = {"primary": "#007A33", "hover": "#005a22", "dark_bg": "#0a1a0f", "panel": "#0f1f13", "banner": "#0c2a16"};
