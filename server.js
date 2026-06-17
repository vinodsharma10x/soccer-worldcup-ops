const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4187);
const CACHE_MS = 35_000;
const COMMENTARY_CACHE_MS = 25_000;
const SUMMARY_CACHE_MS = 45_000;
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const PUBLIC_DIR = path.join(__dirname, "public");
const DISPLAY_TIME_ZONE = "America/New_York";

const LEAGUES = [
  { slug: "fifa.world", name: "Global Program", region: "Worldwide" }
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const cache = new Map();

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      rejectUnauthorized: false,
      headers: {
        accept: "application/json",
        "user-agent": "ops-signal-dashboard/1.0"
      },
      timeout: 10_000
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} returned ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timeout fetching ${url}`));
    });
    request.on("error", reject);
  });
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

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function numeric(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function blankCards() {
  return {
    unitA: { yellow: 0, red: 0 },
    unitB: { yellow: 0, red: 0 },
    totalYellow: 0,
    totalRed: 0,
    details: []
  };
}

function blankOutputEvents() {
  return [];
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
  if (lower.startsWith("attempt saved")) return `Output attempt contained by the receiving unit.`;
  if (lower.startsWith("attempt blocked")) return `Output attempt blocked before completion.`;
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

function cardStatMap(stats = []) {
  const result = {};
  for (const stat of stats) {
    result[stat.name] = numeric(stat.displayValue, 0);
  }
  return result;
}

function unitForTeamId(teamId, summary) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const competitor = competitors.find((item) => String(item.team?.id || item.id) === String(teamId));
  if (!competitor) return "";
  return competitor.homeAway === "away" ? "unitA" : "unitB";
}

function cardDetailsFromCommentary(summary, aliases) {
  return (summary?.commentary || [])
    .filter((item) => /(?:yellow|red)\s+card/i.test(item?.text || item?.shortText || ""))
    .map((item, index) => {
      const text = item.text || item.shortText || "";
      const lower = text.toLowerCase();
      const unit = unitForText(text, aliases);
      return {
        id: `card-${index}-${item?.time?.value ?? "note"}`,
        time: item?.time?.displayValue || item?.displayTime || "Pre",
        type: lower.includes("red card") ? "red" : "yellow",
        unit
      };
    });
}

function cardsFromSummary(summary) {
  const cards = blankCards();
  for (const team of summary?.boxscore?.teams || []) {
    const unitKey = unitForTeamId(team.team?.id, summary);
    if (!unitKey) continue;
    const stats = cardStatMap(team.statistics || []);
    cards[unitKey].yellow = stats.yellowCards || 0;
    cards[unitKey].red = stats.redCards || 0;
  }

  cards.totalYellow = cards.unitA.yellow + cards.unitB.yellow;
  cards.totalRed = cards.unitA.red + cards.unitB.red;
  cards.details = cardDetailsFromCommentary(summary, summaryAliases(summary));
  return cards;
}

function outputEventsFromSummary(summary) {
  const keyEvents = Array.isArray(summary?.keyEvents) ? summary.keyEvents : [];
  const commentary = Array.isArray(summary?.commentary) ? summary.commentary : [];
  const events = keyEvents.length ? keyEvents : commentary.map((item) => item.play || item);

  return events
    .filter((item) => {
      const type = `${item?.type?.type || ""} ${item?.type?.text || ""}`.toLowerCase();
      const text = `${item?.text || item?.shortText || ""}`.toLowerCase();
      return item?.scoringPlay || type.includes("goal") || text.startsWith("goal!") || text.startsWith("own goal");
    })
    .map((item, index) => {
      const unitKey = unitForTeamId(item?.team?.id, summary);
      const fallbackUnit = unitForText(item?.text || item?.shortText || "", summaryAliases(summary));
      const firstParticipant = item?.participants?.[0]?.athlete || {};
      return {
        id: `output-${item?.id || index}`,
        time: item?.clock?.displayValue || item?.time?.displayValue || item?.displayTime || "Pre",
        seconds: numeric(item?.clock?.value ?? item?.time?.value, 0),
        unit: unitKey === "unitA" ? "Unit A" : unitKey === "unitB" ? "Unit B" : fallbackUnit,
        scorer: firstParticipant.displayName || "",
        note: item?.shortText || item?.text || "Output event"
      };
    })
    .sort((a, b) => a.seconds - b.seconds);
}

async function summaryPayload(leagueSlug, eventId) {
  const league = LEAGUES.find((item) => item.slug === leagueSlug);
  if (!league) throw new Error("Unknown feed");
  if (!parseEventId(eventId)) throw new Error("Invalid event id");

  const cacheKey = `summary:${leagueSlug}:${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < SUMMARY_CACHE_MS) return cached.payload;

  const payload = await fetchJson(`${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`);
  cache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

function normalizeEvent(event, league) {
  const competition = event?.competitions?.[0] || {};
  const competitors = [...(competition.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const home = unitFromCompetitor(competitors.find((item) => item.homeAway === "home") || competitors[0]);
  const away = unitFromCompetitor(competitors.find((item) => item.homeAway === "away") || competitors[1] || competitors[0]);
  const type = competition.status?.type || {};
  const state = classifyStatus(type);
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
    timestamp,
    windowLabel: new Intl.DateTimeFormat("en-US", {
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
    cards: blankCards(),
    outputEvents: blankOutputEvents(),
    rawName: event.name,
    rawShortName: event.shortName
  };
}

async function enrichEventCards(event) {
  try {
    const summary = await summaryPayload(event.leagueSlug, event.id);
    return {
      ...event,
      cards: cardsFromSummary(summary),
      outputEvents: outputEventsFromSummary(summary)
    };
  } catch (_error) {
    return event;
  }
}

async function fetchLeague(league, dateKey) {
  const url = `${ESPN_BASE}/${league.slug}/scoreboard?dates=${dateKey}`;
  const data = await fetchJson(url);
  return (data.events || []).map((event) => ({
    ...normalizeEvent(event, league),
    sourceDateKey: dateKey
  }));
}

async function scoresPayload(dateKeys) {
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
  const enriched = await Promise.all(events.map((event) => enrichEventCards(event)));
  events.splice(0, events.length, ...enriched);
  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

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

  const data = await summaryPayload(leagueSlug, eventId);
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

async function handleApi(req, res, url) {
  if (url.pathname === "/api/scores") {
    const offset = parseOffset(url.searchParams.get("offset"));
    const dateKeys = parseDateKeys(url.searchParams.get("date"), offset);

    try {
      json(res, 200, await scoresPayload(dateKeys));
    } catch (error) {
      json(res, 502, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/commentary") {
    try {
      json(res, 200, await commentaryPayload(url.searchParams.get("league"), url.searchParams.get("event")));
    } catch (error) {
      json(res, 502, { error: error.message });
    }
    return;
  }

  json(res, 404, { error: "Unknown API route" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Ops Signal Dashboard running at http://localhost:${PORT}`);
});
