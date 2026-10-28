import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { clearScoreboards } from "../web/src/backend/nba/data";
import { setStatsSpacing } from "../web/src/backend/nba/stats";

// Each test serves its own scoreboard.
beforeEach(() => clearScoreboards());

setStatsSpacing(0);
