const CACHE_MS = 35_000;
const COMMENTARY_CACHE_MS = 25_000;
const PREDICTION_CACHE_MS = 60_000;
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const PREDICTION_RAW_BASE = "https://raw.githubusercontent.com/AmeyaPatil1989/fifa-2026-predictor/main";
const DISPLAY_TIME_ZONE = "America/New_York";

const LEAGUES = [
  { slug: "fifa.world", name: "Global Program", region: "Worldwide" }
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg"
};

const cache = new Map();

const predictionFiles = {
  matches: {
    remote: `${PREDICTION_RAW_BASE}/output/match_predictions.csv`,
    local: "/data/predictions/match_predictions.csv"
  },
  tournament: {
    remote: `${PREDICTION_RAW_BASE}/output/tournament_probabilities.csv`,
    local: "/data/predictions/tournament_probabilities.csv"
  },
  standings: {
    remote: `${PREDICTION_RAW_BASE}/output/group_standings.csv`,
    local: "/data/predictions/group_standings.csv"
  },
  scorers: {
    remote: `${PREDICTION_RAW_BASE}/output/wc2026_scorers.csv`,
    local: "/data/predictions/wc2026_scorers.csv"
  }
};

const teamAliases = new Map();

const securityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests"
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

function applySecurityHeaders(headers) {
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }
  return headers;
}

function cacheControlForExtension(extension) {
  return [".html", ".css", ".js"].includes(extension) ? "no-cache" : "public, max-age=60";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "ops-signal-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/csv,text/plain,*/*",
      "user-agent": "soccer-worldcup-ops/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

async function readBundledPredictionText(env, pathname) {
  if (!env?.ASSETS) throw new Error("Static asset binding is unavailable.");
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(pathname, "https://assets.local")));
  if (!assetResponse.ok) throw new Error(`${pathname} returned ${assetResponse.status}`);
  return assetResponse.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < String(text || "").length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((item) => item !== "")) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

function nameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

[
  ["USA", "United States"],
  ["United States of America", "United States"],
  ["USMNT", "United States"],
  ["Korea Republic", "South Korea"],
  ["Republic of Korea", "South Korea"],
  ["Cote d Ivoire", "Ivory Coast"],
  ["Côte d'Ivoire", "Ivory Coast"],
  ["Democratic Republic of the Congo", "DR Congo"],
  ["Congo DR", "DR Congo"],
  ["DRC", "DR Congo"],
  ["Curacao", "Curaçao"],
  ["Curaçao", "Curaçao"],
  ["Cape Verde Islands", "Cape Verde"],
  ["Cabo Verde", "Cape Verde"],
  ["Czechia", "Czech Republic"],
  ["Türkiye", "Turkey"],
  ["Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  ["IR Iran", "Iran"]
].forEach(([alias, canonical]) => {
  teamAliases.set(nameKey(alias), nameKey(canonical));
});

function teamKey(value) {
  const key = nameKey(value);
  return teamAliases.get(key) || key;
}

function dateKeyFromPredictionDate(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.replaceAll("-", "") : "";
}

function numberOrNull(value) {
  if (String(value ?? "").trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanText(value) {
  return /^true$/i.test(String(value || "").trim());
}

async function loadPredictionCsv(kind, env) {
  const spec = predictionFiles[kind];
  const cacheKey = `prediction-csv:${kind}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PREDICTION_CACHE_MS) return cached.payload;

  let text = "";
  let source = "raw-github";
  let error = "";

  try {
    text = await fetchText(spec.remote);
  } catch (remoteError) {
    error = remoteError.message;
    source = "bundled";
    text = await readBundledPredictionText(env, spec.local);
  }

  const payload = {
    kind,
    source,
    error,
    fetchedAt: new Date().toISOString(),
    rows: parseCsv(text)
  };
  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

function normalizePredictionRow(row) {
  return {
    date: row.date,
    dateKey: dateKeyFromPredictionDate(row.date),
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeKey: teamKey(row.home_team),
    awayKey: teamKey(row.away_team),
    city: row.city,
    country: row.country,
    homeElo: numberOrNull(row.home_elo),
    awayElo: numberOrNull(row.away_elo),
    pHomeWin: numberOrNull(row.p_home_win),
    pDraw: numberOrNull(row.p_draw),
    pAwayWin: numberOrNull(row.p_away_win),
    expHomeGoals: numberOrNull(row.exp_home_goals),
    expAwayGoals: numberOrNull(row.exp_away_goals),
    predictedResult: row.predicted_result || "",
    completed: booleanText(row.completed),
    actualHomeScore: numberOrNull(row.actual_home_score),
    actualAwayScore: numberOrNull(row.actual_away_score),
    actualResult: row.actual_result || ""
  };
}

function normalizeTournamentRow(row) {
  return {
    team: row.team,
    teamKey: teamKey(row.team),
    group: row.group,
    winProbability: numberOrNull(row.win_probability),
    winPct: numberOrNull(row.win_pct),
    simulatedWins: numberOrNull(row.simulated_wins),
    elo: numberOrNull(row.elo),
    rank: numberOrNull(row.rank)
  };
}

async function predictionPayload(env) {
  const cacheKey = "prediction-payload";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PREDICTION_CACHE_MS) return cached.payload;

  const [matchesCsv, tournamentCsv, standingsCsv, scorersCsv] = await Promise.all([
    loadPredictionCsv("matches", env),
    loadPredictionCsv("tournament", env),
    loadPredictionCsv("standings", env),
    loadPredictionCsv("scorers", env)
  ]);
  const matches = matchesCsv.rows.map(normalizePredictionRow);
  const byMatchKey = new Map();
  for (const match of matches) {
    if (!match.dateKey || !match.homeKey || !match.awayKey) continue;
    byMatchKey.set(`${match.dateKey}:${match.homeKey}:${match.awayKey}`, match);
  }

  const tournament = tournamentCsv.rows
    .map(normalizeTournamentRow)
    .filter((row) => row.team && Number.isFinite(row.winPct))
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));

  const payload = {
    generatedAt: new Date().toISOString(),
    attribution: "Prediction data from AmeyaPatil1989/fifa-2026-predictor",
    sources: {
      matches: matchesCsv.source,
      tournament: tournamentCsv.source,
      standings: standingsCsv.source,
      scorers: scorersCsv.source
    },
    errors: [matchesCsv, tournamentCsv, standingsCsv, scorersCsv]
      .filter((item) => item.error)
      .map((item) => ({ kind: item.kind, message: item.error })),
    matches,
    byMatchKey,
    tournamentLeaders: tournament.slice(0, 8),
    standings: standingsCsv.rows,
    scorers: scorersCsv.rows
  };
  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

function predictionSideLabel(result, reversed) {
  if (result === "Draw") return "draw";
  if (result === "Home Win") return reversed ? "unitA" : "unitB";
  if (result === "Away Win") return reversed ? "unitB" : "unitA";
  return "";
}

function predictionForEvent(event, predictions) {
  const dateKey = event.sourceDateKey || dateKeyForInstant(event.timestamp);
  const unitBKey = teamKey(event.unitB?.label || event.unitB?.code);
  const unitAKey = teamKey(event.unitA?.label || event.unitA?.code);
  const direct = predictions.byMatchKey.get(`${dateKey}:${unitBKey}:${unitAKey}`);
  const reverse = predictions.byMatchKey.get(`${dateKey}:${unitAKey}:${unitBKey}`);
  const row = direct || reverse;
  if (!row) return null;

  const reversed = Boolean(reverse && !direct);
  const unitBWin = reversed ? row.pAwayWin : row.pHomeWin;
  const unitAWin = reversed ? row.pHomeWin : row.pAwayWin;
  const unitBXg = reversed ? row.expAwayGoals : row.expHomeGoals;
  const unitAXg = reversed ? row.expHomeGoals : row.expAwayGoals;
  const unitBElo = reversed ? row.awayElo : row.homeElo;
  const unitAElo = reversed ? row.homeElo : row.awayElo;
  const favorite = [
    { side: "unitB", probability: unitBWin },
    { side: "draw", probability: row.pDraw },
    { side: "unitA", probability: unitAWin }
  ].filter((item) => Number.isFinite(item.probability))
    .sort((a, b) => b.probability - a.probability)[0] || { side: "", probability: null };
  const predictedSide = predictionSideLabel(row.predictedResult, reversed);
  const actualSide = predictionSideLabel(row.actualResult, reversed);

  return {
    provider: "AmeyaPatil1989/fifa-2026-predictor",
    date: row.date,
    sourceHomeTeam: row.homeTeam,
    sourceAwayTeam: row.awayTeam,
    sourceCity: row.city,
    sourceCountry: row.country,
    unitBWin,
    draw: row.pDraw,
    unitAWin,
    unitBXg,
    unitAXg,
    unitBElo,
    unitAElo,
    favoriteSide: favorite.side,
    favoriteProbability: favorite.probability,
    predictedResult: row.predictedResult,
    predictedSide,
    actualResult: row.actualResult,
    actualSide,
    modelHit: row.actualResult && row.actualResult !== "Upcoming" ? row.predictedResult === row.actualResult : null,
    completed: row.completed,
    matchedReversed: reversed
  };
}

const REGULATION_MINUTES = 90;
const LIVE_GOAL_CAP = 10;

function logFactorial(n) {
  let sum = 0;
  for (let i = 2; i <= n; i += 1) sum += Math.log(i);
  return sum;
}

function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function clampRange(value, lo, hi) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(lo, Math.min(hi, value));
}

// Pre-match scoring rates (lambda) per team: prefer Ameya's expected goals,
// fall back to an Elo-derived estimate so newer/knockout fixtures still work.
function baseExpectedGoals(prediction) {
  const lamB = prediction?.unitBXg;
  const lamA = prediction?.unitAXg;
  if (Number.isFinite(lamB) && Number.isFinite(lamA)) return { lamB, lamA };

  const eloB = prediction?.unitBElo;
  const eloA = prediction?.unitAElo;
  if (Number.isFinite(eloB) && Number.isFinite(eloA)) {
    const total = 2.6;
    const share = 1 / (1 + Math.pow(10, (eloA - eloB) / 400));
    return { lamB: total * share, lamA: total * (1 - share) };
  }
  return null;
}

// Option B: each red card lowers the offending team's rate and lifts the opponent's.
function redCardMultipliers(event) {
  const redB = event?.cards?.unitB?.red || 0;
  const redA = event?.cards?.unitA?.red || 0;
  return {
    adjB: Math.pow(0.78, redB) * Math.pow(1.12, redA),
    adjA: Math.pow(0.78, redA) * Math.pow(1.12, redB)
  };
}

// Option B: nudge remaining rates toward how the match is actually flowing,
// comparing observed shot quality so far against the pre-match expectation.
function shotSignalMultipliers(event, minute, lamB, lamA) {
  const elapsed = Math.min(1, minute / REGULATION_MINUTES);
  if (elapsed <= 0) return { sigB: 1, sigA: 1 };
  const observed = (unit) => (unit?.target || 0) * 0.33 + Math.max(0, (unit?.shots || 0) - (unit?.target || 0)) * 0.05;
  const ratio = (obs, lam) => clampRange(obs / Math.max(0.05, lam * elapsed), 0.6, 1.6);
  return {
    sigB: Math.sqrt(ratio(observed(event?.unitB), lamB)),
    sigA: Math.sqrt(ratio(observed(event?.unitA), lamA))
  };
}

// In-play 3-way win probability from current score + remaining-goal Poisson.
function liveWinProbability(event, prediction) {
  const base = baseExpectedGoals(prediction);
  if (!base) return null;

  const closed = event.state === "closed";
  const live = event.state === "live";
  const minute = closed ? REGULATION_MINUTES : Math.max(0, Math.min(95, Number(event.minute) || 0));
  const gB = Number(event.unitB?.score) || 0;
  const gA = Number(event.unitA?.score) || 0;

  if (closed) {
    return {
      pUnitB: gB > gA ? 1 : 0,
      pDraw: gB === gA ? 1 : 0,
      pUnitA: gA > gB ? 1 : 0,
      basis: "final",
      minute
    };
  }

  // Floor remaining time while live so a late match never locks to 100%.
  const remainingFraction = live
    ? clampRange((REGULATION_MINUTES - minute) / REGULATION_MINUTES, 0.03, 1)
    : 1;

  const { adjB, adjA } = redCardMultipliers(event);
  let lamB = base.lamB;
  let lamA = base.lamA;
  if (live && minute >= 15) {
    const { sigB, sigA } = shotSignalMultipliers(event, minute, lamB, lamA);
    lamB *= sigB;
    lamA *= sigA;
  }

  const remB = Math.max(0, lamB * remainingFraction * adjB);
  const remA = Math.max(0, lamA * remainingFraction * adjA);

  let pB = 0;
  let pD = 0;
  let pA = 0;
  for (let i = 0; i <= LIVE_GOAL_CAP; i += 1) {
    const pi = poissonPmf(remB, i);
    for (let j = 0; j <= LIVE_GOAL_CAP; j += 1) {
      const p = pi * poissonPmf(remA, j);
      const finalB = gB + i;
      const finalA = gA + j;
      if (finalB > finalA) pB += p;
      else if (finalB < finalA) pA += p;
      else pD += p;
    }
  }

  const total = pB + pD + pA || 1;
  return {
    pUnitB: pB / total,
    pDraw: pD / total,
    pUnitA: pA / total,
    basis: remainingFraction === 1 ? "pre" : "live",
    minute
  };
}

function attachPredictions(events, predictions) {
  let matched = 0;
  const withPredictions = events.map((event) => {
    const prediction = predictionForEvent(event, predictions);
    if (!prediction) return event;
    matched += 1;
    const liveForecast = liveWinProbability(event, prediction);
    return liveForecast ? { ...event, prediction, liveForecast } : { ...event, prediction };
  });
  return { events: withPredictions, matched };
}

function dateKeyFromParts(parts) {
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}${lookup.month}${lookup.day}`;
}

function dateKeyForInstant(value) {
  return dateKeyFromParts(new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value)));
}

function localDateKey(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(lookup.year), Number(lookup.month) - 1, Number(lookup.day) + offsetDays, 12));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function dateKeysForOffset(offset = 0) {
  return [localDateKey(offset)];
}

function parseOffset(value) {
  const offset = Number(value || 0);
  if (!Number.isFinite(offset)) return 0;
  return Math.max(-3, Math.min(3, Math.trunc(offset)));
}

function parseDateKeys(value, offset) {
  if (/^\d{8}$/.test(value || "")) return [value];
  return dateKeysForOffset(offset);
}

function parseEventId(value) {
  return /^\d+$/.test(value || "") ? value : "";
}

function json(body, statusCode = 200, method = "GET") {
  const payload = JSON.stringify(body);
  return new Response(method === "HEAD" ? null : payload, {
    status: statusCode,
    headers: applySecurityHeaders(new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": String(new TextEncoder().encode(payload).length)
    }))
  });
}

function methodNotAllowed(method) {
  const payload = JSON.stringify({ error: "Method not allowed" });
  return new Response(method === "HEAD" ? null : payload, {
    status: 405,
    headers: applySecurityHeaders(new Headers({
      allow: "GET, HEAD",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": String(new TextEncoder().encode(payload).length)
    }))
  });
}

function numeric(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statMap(competitor) {
  const result = {};
  for (const stat of competitor?.statistics || []) {
    result[stat.name] = numeric(stat.displayValue, 0);
  }
  return result;
}

function unitFromCompetitor(competitor) {
  const stats = statMap(competitor);
  const score = numeric(competitor?.score, null);
  const shots = stats.totalShots || 0;
  const target = stats.shotsOnTarget || 0;
  const corners = stats.wonCorners || 0;
  const possession = stats.possessionPct || 0;
  const pressure = Math.min(100, Math.round(shots * 3 + target * 8 + corners * 4 + (score || 0) * 18));

  return {
    id: competitor?.id || "",
    code: competitor?.team?.abbreviation || competitor?.team?.shortDisplayName || "N/A",
    label: competitor?.team?.displayName || competitor?.team?.shortDisplayName || "Unknown",
    score,
    possession,
    shots,
    target,
    corners,
    pressure,
    winner: Boolean(competitor?.winner)
  };
}

function classifyStatus(type) {
  const state = type?.state || "pre";
  if (state === "in") return "live";
  if (state === "post" || type?.completed) return "closed";
  return "queued";
}

function phaseLabel(type) {
  const status = classifyStatus(type);
  if (status === "live") return type?.shortDetail || type?.detail || "Active";
  if (status === "closed") return type?.shortDetail || "Closed";
  return type?.shortDetail || "Queued";
}

function neutralNote(note = "") {
  return String(note)
    .replace(/FIFA World Cup,?\s*/gi, "")
    .replace(/Premier League/gi, "Priority Tier")
    .replace(/LaLiga/gi, "Iberia Tier")
    .replace(/Bundesliga/gi, "Northern Tier")
    .replace(/Serie A/gi, "Central Tier")
    .replace(/Ligue 1/gi, "Western Tier")
    .replace(/UEFA Champions League/gi, "Enterprise Tier")
    .replace(/International Friendly/gi, "Partner Tier")
    .replace(/MLS/gi, "North America Tier")
    .replace(/NWSL/gi, "North America Edge")
    .replace(/Liga BBVA MX/gi, "LATAM North Tier")
    .replace(/Brazilian Serie A/gi, "LATAM South Tier")
    .replace(/Argentine Liga Profesional de Fútbol/gi, "Southern Cone Tier")
    .replace(/Group\s+/gi, "Sector ")
    .trim();
}

function aliasKeys(value) {
  const base = String(value || "").trim();
  if (!base) return [];
  const keys = new Set([base.toLowerCase()]);
  if (/cape verde/i.test(base)) keys.add("cabo verde");
  if (/cabo verde/i.test(base)) keys.add("cape verde");
  return [...keys];
}

// Elapsed match minute from ESPN status; prefer the displayed clock ("63'").
function liveMinuteFromStatus(status) {
  const display = String(status?.displayClock || status?.type?.shortDetail || "");
  const shown = display.match(/(\d+)/);
  if (shown) return Math.min(130, Number(shown[1]));
  const clock = Number(status?.clock);
  if (Number.isFinite(clock) && clock > 0) return clock > 130 ? Math.round(clock / 60) : Math.round(clock);
  return 0;
}

function summaryAliases(summary) {
  const aliases = new Map();
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];

  for (const competitor of competitors) {
    const unit = competitor.homeAway === "away" ? "Unit A" : "Unit B";
    const team = competitor.team || {};
    for (const value of [team.displayName, team.shortDisplayName, team.location, team.abbreviation]) {
      for (const key of aliasKeys(value)) aliases.set(key, unit);
    }
  }

  return aliases;
}

function unitForText(text, aliases) {
  const raw = String(text || "").toLowerCase();
  const parenthetical = raw.match(/\(([^)]+)\)/);
  if (parenthetical && aliases.has(parenthetical[1].trim())) return aliases.get(parenthetical[1].trim());

  for (const [alias, unit] of aliases.entries()) {
    if (raw.includes(alias)) return unit;
  }

  return "a unit";
}

function zoneFromText(text) {
  const raw = String(text || "").toLowerCase();
  if (raw.includes("defensive half")) return "defensive";
  if (raw.includes("attacking half")) return "forward";
  if (raw.includes("middle third")) return "central";
  return "current";
}

function sanitizeFallback(text, aliases) {
  let safe = String(text || "").trim();
  safe = safe.replace(/[A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'’.-]+){0,4}\s+\(([^)]+)\)/g, (_match, team) => {
    return aliases.get(String(team).toLowerCase()) || "a unit";
  });

  for (const [alias, unit] of aliases.entries()) {
    safe = safe.replace(new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), unit);
  }

  return safe
    .replace(/\bplayers?\b/gi, "resources")
    .replace(/\bmatch\b/gi, "window")
    .replace(/\bgoal\b/gi, "target")
    .replace(/\bshot\b/gi, "output attempt")
    .replace(/\bcorner\b/gi, "boundary restart")
    .replace(/\bfoul\b/gi, "exception")
    .replace(/\bfree kick\b/gi, "reset")
    .replace(/\byellow card\b/gi, "caution flag");
}

function neutralCommentary(text, aliases) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  const unit = unitForText(raw, aliases);

  if (!raw) return "No note text provided.";
  if (lower.includes("lineups are announced")) return "Resource lineup confirmed; pre-window readiness checks are active.";
  if (lower.includes("first half begins")) return "Primary operating window opened.";
  if (lower.includes("second half begins")) return "Secondary operating window opened.";
  if (lower.includes("first half ends")) return "Primary operating window closed.";
  if (lower.includes("second half ends")) return "Secondary operating window closed.";
  if (lower.includes("match ends") || lower.includes("full time")) return "Operating window closed.";
  if (lower.includes("added time")) return "Extension window added to the current cycle.";
  if (lower.startsWith("goal!")) return `Major output event registered for ${unit}.`;
  if (lower.startsWith("own goal")) return `Major output event self-routed by ${unit}.`;
  if (lower.startsWith("attempt saved")) return "Output attempt contained by the receiving unit.";
  if (lower.startsWith("attempt blocked")) return "Output attempt blocked before completion.";
  if (lower.startsWith("attempt missed")) return `Output attempt did not convert for ${unit}.`;
  if (lower.startsWith("corner,")) return `Boundary restart awarded to ${unit}.`;
  if (lower.startsWith("foul by")) return `Exception logged against ${unit}.`;
  if (lower.includes("wins a free kick")) return `${unit} secured a reset in the ${zoneFromText(raw)} zone.`;
  if (lower.includes("yellow card")) return `Caution flag issued to ${unit}.`;
  if (lower.startsWith("substitution")) return `Resource change executed for ${unit}.`;
  if (lower.startsWith("offside")) return `Timing exception logged against ${unit}.`;
  if (lower.startsWith("var decision")) return "Review decision recorded by the control desk.";
  if (lower.startsWith("delay")) return "Delay logged in the current operating window.";

  return sanitizeFallback(raw, aliases);
}

function normalizeCommentaryItem(item, index, aliases) {
  const text = item?.text || item?.shortText || "";
  return {
    id: `${index}-${item?.time?.value ?? "note"}`,
    time: item?.time?.displayValue || item?.displayTime || (String(text).toLowerCase().includes("match ends") ? "Final" : "Pre"),
    note: neutralCommentary(text, aliases)
  };
}

function normalizeEvent(event, league) {
  const competition = event?.competitions?.[0] || {};
  const competitors = [...(competition.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const home = unitFromCompetitor(competitors.find((item) => item.homeAway === "home") || competitors[0]);
  const away = unitFromCompetitor(competitors.find((item) => item.homeAway === "away") || competitors[1] || competitors[0]);
  const type = competition.status?.type || {};
  const state = classifyStatus(type);
  const minute = liveMinuteFromStatus(competition.status || {});
  const timestamp = event.date || competition.date || competition.startDate;
  const totalShots = home.shots + away.shots;
  const totalTarget = home.target + away.target;
  const totalOutput = (home.score || 0) + (away.score || 0);
  const signal = Math.min(100, Math.round(totalShots * 2.5 + totalTarget * 7 + totalOutput * 12));
  const splitA = away.possession || Math.max(0, 50 - Math.min(30, home.pressure - away.pressure) / 2);
  const splitB = home.possession || 100 - splitA;
  const note = neutralNote(competition.altGameNote || event.season?.slug || "");

  return {
    id: event.id,
    leagueSlug: league.slug,
    program: league.name,
    region: league.region,
    sourceProgram: event.leagueName || "",
    market: note || league.region,
    state,
    phase: phaseLabel(type),
    statusDetail: type.detail || type.description || "",
    minute,
    timestamp,
    windowLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: DISPLAY_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(new Date(timestamp)),
    unitA: away,
    unitB: home,
    output: `${away.score ?? "-"} / ${home.score ?? "-"}`,
    spread: Math.abs((home.score || 0) - (away.score || 0)),
    splitA: Math.round(splitA),
    splitB: Math.round(splitB),
    signal,
    totalShots,
    totalTarget,
    venue: competition.venue?.address?.city || competition.venue?.fullName || "",
    channel: competition.broadcasts?.length ? "Primary telemetry" : "External feed",
    rawName: event.name,
    rawShortName: event.shortName
  };
}

async function fetchLeague(league, dateKey) {
  const url = `${ESPN_BASE}/${league.slug}/scoreboard?dates=${dateKey}`;
  const data = await fetchJson(url);
  return (data.events || []).map((event) => ({
    ...normalizeEvent(event, league),
    sourceDateKey: dateKey
  }));
}

async function scoresPayload(dateKeys, env) {
  const cacheKey = `scores:${dateKeys.join(":")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return cached.payload;

  const requests = dateKeys.flatMap((dateKey) => LEAGUES.map((league) => ({ league, dateKey })));
  const settled = await Promise.allSettled(requests.map(({ league, dateKey }) => fetchLeague(league, dateKey)));
  const errors = [];
  const deduped = new Map();

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === "fulfilled") {
      for (const event of result.value) {
        deduped.set(`${event.leagueSlug}:${event.id}`, event);
      }
    } else {
      errors.push({
        source: requests[index].league.name,
        dateKey: requests[index].dateKey,
        message: result.reason.message
      });
    }
  }

  const events = [...deduped.values()].filter((event) => {
    return !event.timestamp || dateKeys.includes(dateKeyForInstant(event.timestamp));
  });
  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  let predictions = {
    provider: "AmeyaPatil1989/fifa-2026-predictor",
    matched: 0,
    tournamentLeaders: [],
    errors: []
  };

  try {
    const predictionData = await predictionPayload(env);
    const attached = attachPredictions(events, predictionData);
    events.splice(0, events.length, ...attached.events);
    predictions = {
      provider: predictionData.attribution,
      generatedAt: predictionData.generatedAt,
      sources: predictionData.sources,
      matched: attached.matched,
      tournamentLeaders: predictionData.tournamentLeaders,
      errors: predictionData.errors
    };
  } catch (error) {
    predictions.errors = [{ kind: "provider", message: error.message }];
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    dateKey: dateKeys[Math.floor(dateKeys.length / 2)],
    dateKeys,
    timeZone: DISPLAY_TIME_ZONE,
    dateWindow: {
      from: dateKeys[0],
      to: dateKeys[dateKeys.length - 1]
    },
    sources: LEAGUES.length,
    sourceChecks: requests.length,
    errors,
    summary: {
      total: events.length,
      live: events.filter((event) => event.state === "live").length,
      queued: events.filter((event) => event.state === "queued").length,
      closed: events.filter((event) => event.state === "closed").length,
      signal: events.length ? Math.round(events.reduce((sum, event) => sum + event.signal, 0) / events.length) : 0
    },
    predictions,
    events
  };

  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

async function commentaryPayload(leagueSlug, eventId) {
  const league = LEAGUES.find((item) => item.slug === leagueSlug);
  if (!league) throw new Error("Unknown feed");
  if (!parseEventId(eventId)) throw new Error("Invalid event id");

  const cacheKey = `commentary:${leagueSlug}:${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < COMMENTARY_CACHE_MS) return cached.payload;

  const data = await fetchJson(`${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`);
  const aliases = summaryAliases(data);
  const commentary = [...(data.commentary || [])]
    .map((item, index) => normalizeCommentaryItem(item, index, aliases))
    .reverse()
    .slice(0, 12);

  const payload = {
    generatedAt: new Date().toISOString(),
    leagueSlug,
    eventId,
    available: commentary.length > 0,
    commentary
  };

  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

async function handleApi(request, url, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request.method);
  }

  if (url.pathname === "/api/scores") {
    const offset = parseOffset(url.searchParams.get("offset"));
    const dateKeys = parseDateKeys(url.searchParams.get("date"), offset);

    try {
      return json(await scoresPayload(dateKeys, env), 200, request.method);
    } catch (error) {
      return json({ error: error.message }, 502, request.method);
    }
  }

  if (url.pathname === "/api/commentary") {
    try {
      return json(await commentaryPayload(url.searchParams.get("league"), url.searchParams.get("event")), 200, request.method);
    } catch (error) {
      return json({ error: error.message }, 502, request.method);
    }
  }

  return json({ error: "Unknown API route" }, 404, request.method);
}

async function serveStatic(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request.method);
  }

  if (!env?.ASSETS) {
    return new Response("Static asset binding is unavailable.", {
      status: 500,
      headers: applySecurityHeaders(new Headers())
    });
  }

  const url = new URL(request.url);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

  if (pathname.includes("..")) {
    return new Response("Forbidden", {
      status: 403,
      headers: applySecurityHeaders(new Headers())
    });
  }

  const assetUrl = new URL(pathname, request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(assetResponse.headers);
  const extension = pathname.match(/\.[^.]+$/)?.[0] || ".html";

  if (!headers.has("content-type") && contentTypes[extension]) {
    headers.set("content-type", contentTypes[extension]);
  }
  headers.set("cache-control", cacheControlForExtension(extension));
  applySecurityHeaders(headers);

  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env);
    }

    return serveStatic(request, env);
  }
};
