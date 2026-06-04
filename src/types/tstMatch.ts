export type MatchPlayer = {
  nickname: string | null;
  username: string;
  positions: number[];
  score: number;
};

export type MatchTeam = {
  teamName: string;
  players: MatchPlayer[];
  score: number;
  kills: number;
  deaths: number;
  suicides: number;
  zonePoints: number;
  roundPoints: number;
  isWinner: boolean;
};

/** A single match row from `MatchHistory/Get{Tst,Fort}Matches`. */
export type MatchSummary = {
  id: string;
  date: string;
  totalTime: number;
  roundCount: number;
  winner: string;
  teams: MatchTeam[];
};

function isMatchPlayer(value: unknown): value is MatchPlayer {
  if (!value || typeof value !== "object") {
    return false;
  }

  const player = value as Partial<MatchPlayer>;
  return typeof player.username === "string";
}

function isMatchTeam(value: unknown): value is MatchTeam {
  if (!value || typeof value !== "object") {
    return false;
  }

  const team = value as Partial<MatchTeam>;
  return (
    typeof team.teamName === "string" &&
    Array.isArray(team.players) &&
    team.players.every(isMatchPlayer)
  );
}

export function isMatchSummary(value: unknown): value is MatchSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const match = value as Partial<MatchSummary>;
  return (
    typeof match.id === "string" &&
    match.id.length > 0 &&
    Array.isArray(match.teams) &&
    match.teams.every(isMatchTeam)
  );
}
