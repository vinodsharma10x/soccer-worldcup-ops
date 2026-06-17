const CACHE_MS = 35_000;
const COMMENTARY_CACHE_MS = 25_000;
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
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
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg"
};

const cache = new Map();

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

async function handleApi(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request.method);
  }

  if (url.pathname === "/api/scores") {
    const offset = parseOffset(url.searchParams.get("offset"));
    const dateKeys = parseDateKeys(url.searchParams.get("date"), offset);

    try {
      return json(await scoresPayload(dateKeys), 200, request.method);
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
      return handleApi(request, url);
    }

    return serveStatic(request, env);
  }
};
