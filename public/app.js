const state = {
  offset: 0,
  payload: null,
  commentary: null,
  commentaryFor: "",
  reveal: false,
  sinceRefresh: 0,
  chartModel: null,
  timer: null,
  clock: null
};

const elements = {
  headerTitle: document.querySelector("#headerTitle"),
  headerSub: document.querySelector("#headerSub"),
  modeToggle: document.querySelector("#modeToggle"),
  modeLabel: document.querySelector("#modeLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  refreshButton: document.querySelector("#refreshButton"),
  updatedLabel: document.querySelector("#updatedLabel"),
  refreshBar: document.querySelector("#refreshBar"),
  windowChip: document.querySelector("#windowChip"),
  metricLive: document.querySelector("#metricLive"),
  metricTotal: document.querySelector("#metricTotal"),
  metricArtifacts: document.querySelector("#metricArtifacts"),
  artifactDelta: document.querySelector("#artifactDelta"),
  kpiOneLabel: document.querySelector("#kpiOneLabel"),
  kpiTwoLabel: document.querySelector("#kpiTwoLabel"),
  kpiThreeLabel: document.querySelector("#kpiThreeLabel"),
  chartTitle: document.querySelector("#chartTitle"),
  chartUnit: document.querySelector("#chartUnit"),
  legendPrimary: document.querySelector("#legendPrimary"),
  legendSecondary: document.querySelector("#legendSecondary"),
  throughputCanvas: document.querySelector("#throughputCanvas"),
  chartTooltip: document.querySelector("#chartTooltip"),
  sparkCanvases: [
    document.querySelector("#sparkOne"),
    document.querySelector("#sparkTwo"),
    document.querySelector("#sparkThree")
  ],
  liveTitle: document.querySelector("#liveTitle"),
  liveRunningBadge: document.querySelector("#liveRunningBadge"),
  activeGrid: document.querySelector("#activeGrid"),
  recentTitle: document.querySelector("#recentTitle"),
  recentMeta: document.querySelector("#recentMeta"),
  recentRuns: document.querySelector("#recentRuns"),
  queuedTitle: document.querySelector("#queuedTitle"),
  queuedRuns: document.querySelector("#queuedRuns"),
  feedTitle: document.querySelector("#feedTitle"),
  activityFeed: document.querySelector("#activityFeed"),
  notesCount: document.querySelector("#notesCount"),
  notesList: document.querySelector("#notesList"),
  forecastTitle: document.querySelector("#forecastTitle"),
  forecastMeta: document.querySelector("#forecastMeta"),
  forecastList: document.querySelector("#forecastList"),
  regionsList: document.querySelector("#regionsList"),
  oncallLabel: document.querySelector("#oncallLabel")
};

const teamColors = [
  "#74acdf", "#f7c948", "#5b7ce0", "#e2574c", "#e0b13a", "#cbd1d8",
  "#f0883e", "#3fb38a", "#5d8bf0", "#3fb950", "#5aa9e6", "#2dd4bf"
];
const DISPLAY_TIME_ZONE = "America/New_York";
const FORECAST_CREDIT = "Credits: Ameya Patil";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function codeColor(code) {
  const text = String(code || "svc");
  const sum = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
  return teamColors[sum % teamColors.length];
}

function service(unit) {
  return `${String(unit?.code || "svc").toLowerCase().replace(/[^a-z0-9]/g, "")}-svc`;
}

function serviceLabel(unit) {
  return state.reveal ? unit?.label || unit?.code || "Unknown" : service(unit);
}

function subLabel(unit) {
  return state.reveal ? service(unit) : `img:${String(unit?.code || "svc").toLowerCase()}:2026.${unit?.score ?? 0}`;
}

function eventTitle(event) {
  return state.reveal
    ? `${event.unitB.label} vs ${event.unitA.label}`
    : `${service(event.unitB)} ⇄ ${service(event.unitA)}`;
}

function outputPair(event) {
  return {
    left: event.unitB?.score ?? 0,
    right: event.unitA?.score ?? 0
  };
}

function signalQuality(events) {
  const shots = events.reduce((sum, event) => {
    const eventShots = event.totalShots || ((event.unitA?.shots || 0) + (event.unitB?.shots || 0));
    return sum + eventShots;
  }, 0);
  const target = events.reduce((sum, event) => {
    const eventTarget = event.totalTarget || ((event.unitA?.target || 0) + (event.unitB?.target || 0));
    return sum + eventTarget;
  }, 0);
  return {
    shots,
    target,
    rate: shots ? Math.round((target / shots) * 100) : 0
  };
}

function loadSkew(events) {
  if (!events.length) return { skew: 0, leader: "even" };

  let totalSkew = 0;
  let leaderScore = 0;
  let leaderEvent = events[0];

  events.forEach((event) => {
    const unitBShare = Number.isFinite(event?.unitB?.possession) && event.unitB.possession
      ? event.unitB.possession
      : event?.splitB || 50;
    const unitAShare = Number.isFinite(event?.unitA?.possession) && event.unitA.possession
      ? event.unitA.possession
      : event?.splitA || 50;
    const diff = unitBShare - unitAShare;
    totalSkew += Math.abs(diff);
    if (Math.abs(diff) >= Math.abs(leaderScore)) {
      leaderScore = diff;
      leaderEvent = event;
    }
  });

  const leaderUnit = leaderScore >= 0 ? leaderEvent?.unitB : leaderEvent?.unitA;
  return {
    skew: Math.round(totalSkew / events.length),
    leader: Math.abs(leaderScore) < 1 ? "even" : (state.reveal ? leaderUnit?.code || "unit" : service(leaderUnit))
  };
}

function cardCount(event, unitKey, color) {
  return event?.cards?.[unitKey]?.[color] || 0;
}

function cardTotals(event) {
  return {
    yellow: event?.cards?.totalYellow || 0,
    red: event?.cards?.totalRed || 0
  };
}

function cardUnitLabel(event, unit) {
  if (unit === "Unit A") return state.reveal ? event?.unitA?.code || "A" : service(event?.unitA);
  if (unit === "Unit B") return state.reveal ? event?.unitB?.code || "B" : service(event?.unitB);
  return unit || "svc";
}

function cardDetailText(event) {
  const details = event?.cards?.details || [];
  if (!details.length) return state.reveal ? "No yellow or red cards" : "No caution flags";
  return details.map((item) => {
    const marker = item.type === "red" ? "R" : "Y";
    return `${marker} ${noteTime(item.time)} ${cardUnitLabel(event, item.unit)}`;
  }).join(" · ");
}

function cardTimesText(event) {
  const details = event?.cards?.details || [];
  if (!details.length) return "none";
  return details.map((item) => `${item.type === "red" ? "R" : "Y"}${noteTime(item.time)}`).join(" ");
}

function cardSummaryText(event) {
  const home = `${state.reveal ? event?.unitB?.code || "B" : service(event?.unitB)} Y${cardCount(event, "unitB", "yellow")}/R${cardCount(event, "unitB", "red")}`;
  const away = `${state.reveal ? event?.unitA?.code || "A" : service(event?.unitA)} Y${cardCount(event, "unitA", "yellow")}/R${cardCount(event, "unitA", "red")}`;
  return `${home} · ${away}`;
}

function cardBadges(event, compact = false) {
  const totals = cardTotals(event);
  return `
    <div class="${compact ? "card-flags compact" : "card-flags"}" title="${escapeHtml(cardDetailText(event))}">
      <span class="flag-card yellow">Y${totals.yellow}</span>
      <span class="flag-card red">R${totals.red}</span>
      <small>${escapeHtml(compact ? cardTimesText(event) : cardSummaryText(event))}</small>
    </div>
  `;
}

function predictionPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";
}

function creditAttrs() {
  const credit = escapeHtml(FORECAST_CREDIT);
  return `title="${credit}" data-credit="${credit}"`;
}

function predictionXg(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function predictionSideName(event, side, options = {}) {
  if (side === "draw") return state.reveal ? "Draw" : "hold";
  if (side !== "unitA" && side !== "unitB") return "--";
  const unit = side === "unitA" ? event?.unitA : event?.unitB;
  if (state.reveal) return options.long ? unit?.label || unit?.code || "team" : unit?.code || unit?.label || "team";
  return service(unit);
}

function predictionStatusClass(prediction) {
  if (prediction?.modelHit === true) return "hit";
  if (prediction?.modelHit === false) return "miss";
  return "pending";
}

function predictionSummary(event) {
  const prediction = event?.prediction;
  if (!prediction) return "";
  const favorite = predictionSideName(event, prediction.favoriteSide, { long: true });
  const pct = predictionPercent(prediction.favoriteProbability);
  return `${favorite} ${pct}`;
}

function forecastBar(event) {
  const prediction = event?.prediction;
  if (!prediction) return "";
  const unitB = Math.max(0, Math.round((prediction.unitBWin || 0) * 100));
  const draw = Math.max(0, Math.round((prediction.draw || 0) * 100));
  const unitA = Math.max(0, Math.round((prediction.unitAWin || 0) * 100));

  return `
    <div class="forecast-bar-hitbox credit-hover" ${creditAttrs()}>
      <div class="forecast-bar">
        <i class="forecast-home" style="width:${unitB}%"></i>
        <i class="forecast-draw" style="width:${draw}%"></i>
        <i class="forecast-away" style="width:${unitA}%"></i>
      </div>
    </div>
  `;
}

function forecastStrip(event, compact = false) {
  const prediction = event?.prediction;
  if (!prediction) return "";
  const statusClass = predictionStatusClass(prediction);
  const unitB = predictionSideName(event, "unitB");
  const unitA = predictionSideName(event, "unitA");
  const hitLabel = prediction.modelHit === true ? "hit" : prediction.modelHit === false ? "miss" : "pending";

  return `
    <div class="forecast-strip ${compact ? "compact" : ""} ${statusClass}">
      <div class="forecast-head">
        <span class="credit-hover" ${creditAttrs()}>forecast</span>
        <strong>${escapeHtml(predictionSummary(event))}</strong>
        <small>xG ${escapeHtml(unitB)} ${predictionXg(prediction.unitBXg)} · ${escapeHtml(unitA)} ${predictionXg(prediction.unitAXg)}</small>
      </div>
      ${forecastBar(event)}
      <div class="forecast-stats">
        <span>${escapeHtml(unitB)} ${predictionPercent(prediction.unitBWin)}</span>
        <span>${state.reveal ? "D" : "hold"} ${predictionPercent(prediction.draw)}</span>
        <span>${escapeHtml(unitA)} ${predictionPercent(prediction.unitAWin)}</span>
        ${prediction.modelHit === null ? "" : `<em>${hitLabel}</em>`}
      </div>
    </div>
  `;
}

function forecastDetailChip(event) {
  const prediction = event?.prediction;
  if (!prediction) return "";
  const hitLabel = prediction.modelHit === true ? "hit" : prediction.modelHit === false ? "miss" : "pending";
  return `
    <span class="detail-chip forecast-detail-chip ${predictionStatusClass(prediction)}">
      <b class="credit-hover" ${creditAttrs()}>forecast</b>${escapeHtml(predictionSummary(event))}
      ${prediction.modelHit === null ? "" : `<em>${hitLabel}</em>`}
    </span>
  `;
}

function forecastTooltipRow(event) {
  const prediction = event?.prediction;
  if (!prediction) return "";
  const unitB = predictionSideName(event, "unitB");
  const unitA = predictionSideName(event, "unitA");
  return `
    <li><strong class="credit-hover" ${creditAttrs()}>forecast</strong><span>${escapeHtml(predictionSummary(event))}</span><em>xG ${escapeHtml(unitB)} ${predictionXg(prediction.unitBXg)} · ${escapeHtml(unitA)} ${predictionXg(prediction.unitAXg)}</em></li>
  `;
}

function outputEventUnitLabel(event, unit) {
  if (unit === "Unit A") return state.reveal ? event?.unitA?.code || "A" : service(event?.unitA);
  if (unit === "Unit B") return state.reveal ? event?.unitB?.code || "B" : service(event?.unitB);
  return unit || "svc";
}

function outputEventPosition(event) {
  const seconds = Number(event?.seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(1, Math.min(99, Math.round((seconds / 5400) * 100)));

  const minute = String(event?.time || "").match(/(\d+)'/);
  if (!minute) return 1;
  return Math.max(1, Math.min(99, Math.round((Number(minute[1]) / 90) * 100)));
}

function outputEventTitle(event, item) {
  const time = noteTime(item.time);
  const unit = outputEventUnitLabel(event, item.unit);
  if (state.reveal && item.scorer) return `${item.scorer} · ${unit} · ${time}`;
  return `Major output event · ${unit} · ${time}`;
}

function scorerInitial(item) {
  const firstName = String(item?.scorer || "").trim().split(/\s+/)[0] || "";
  return firstName ? firstName.slice(0, 1).toUpperCase() : "";
}

function outputEventLabel(item) {
  const initial = scorerInitial(item);
  return initial ? `${initial} ${noteTime(item.time)}` : noteTime(item.time);
}

function outputEventPills(event) {
  const outputs = event?.outputEvents || [];
  if (!outputs.length) return `<em>none</em>`;

  return outputs.map((item) => `
    <span class="output-pill" title="${escapeHtml(outputEventTitle(event, item))}">
      ${escapeHtml(outputEventLabel(item))}
    </span>
  `).join("");
}

function markerClassForPosition(position) {
  if (position > 92) return "near-end";
  if (position < 8) return "near-start";
  return "";
}

function outputMarkers(event, options = {}) {
  const markers = event?.outputEvents || [];
  if (!markers.length) return "";
  const positionCounts = new Map();

  return markers.map((item) => {
    const position = outputEventPosition(item);
    const stackIndex = positionCounts.get(position) || 0;
    positionCounts.set(position, stackIndex + 1);
    const labelOffset = options.stackLabels ? stackIndex * 17 : 0;
    const markerClass = markerClassForPosition(position);

    return `
    <i class="progress-marker ${markerClass}" style="left:${position}%;--label-offset:${labelOffset}px" title="${escapeHtml(outputEventTitle(event, item))}" aria-label="${escapeHtml(outputEventTitle(event, item))}">
      <b>${escapeHtml(outputEventLabel(item))}</b>
    </i>
  `;
  }).join("");
}

function pseudoHash(input) {
  const text = String(input || "continuum");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 7).padEnd(7, "0");
}

function minuteValue(event) {
  const match = String(event?.phase || "").match(/(\d+)'/);
  if (match) return Math.min(100, Math.round((Number(match[1]) / 90) * 100));
  if (event?.state === "closed") return 100;
  if (event?.state === "queued") return 0;
  return Math.max(8, Math.min(100, event?.signal || 28));
}

function phaseMeta(event) {
  if (state.reveal) {
    if (event.state === "live") return `${event.phase} · ${event.venue || event.market || event.region}`;
    if (event.state === "closed") return `FT · ${event.market || event.region}`;
    return `${formatClock(event.timestamp)} · ${event.market || event.region}`;
  }

  if (event.state === "live") return `${event.market || "prod"} · ${event.region || "global"} · ${event.phase}`;
  if (event.state === "closed") return `${event.market || "prod"} · resolved`;
  return `${event.market || "prod"} · scheduled`;
}

function statusLabel(event) {
  if (state.reveal) {
    if (event.state === "live") return `LIVE ${event.phase}`;
    if (event.state === "closed") return "FT";
    return "SCHED";
  }

  if (event.state === "live") return "RUNNING";
  if (event.state === "closed") return "PASSED";
  return "QUEUED";
}

function formatClock(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatShortClock(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function hourInEastern(value) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
  return Number(hour);
}

function minuteOfDayInEastern(value) {
  if (!value) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(lookup.hour || 0) * 60 + Number(lookup.minute || 0);
}

function selectedDayLabel() {
  const dateKey = state.payload?.dateKey;
  if (!dateKey || dateKey.length !== 8) return "Today ET";
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(4, 6));
  const day = Number(dateKey.slice(6, 8));
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  if (state.offset === 0) return `Today ET · ${label}`;
  if (state.offset === -1) return `Yesterday ET · ${label}`;
  if (state.offset === 1) return `Tomorrow ET · ${label}`;
  return `${label} ET`;
}

function durationLabel(event) {
  if (event.state === "queued") return formatClock(event.timestamp);
  const minute = String(event.phase || "").match(/(\d+)'/);
  if (minute) return `${minute[1]}m`;
  return event.state === "closed" ? "90m" : "live";
}

function setSyncStatus(mode, text) {
  elements.syncStatus.classList.remove("online", "offline");
  if (mode) elements.syncStatus.classList.add(mode);
  elements.syncStatus.querySelector("span:last-child").textContent = text;
}

function activeEvents() {
  return (state.payload?.events || []).filter((event) => event.state === "live");
}

function recentEvents() {
  return (state.payload?.events || []).filter((event) => event.state === "closed").slice(-8).reverse();
}

function queuedEvents() {
  return (state.payload?.events || []).filter((event) => event.state === "queued").slice(0, 8);
}

function candidateForCommentary() {
  const events = state.payload?.events || [];
  return events.find((event) => event.state === "live")
    || events.find((event) => event.state === "closed")
    || events[0];
}

function noteForMode(note, event) {
  if (state.reveal) {
    return String(note.note || "")
      .replaceAll("Unit A", event?.unitA?.label || "away")
      .replaceAll("Unit B", event?.unitB?.label || "home")
      .replaceAll("a unit", "a team");
  }
  const a = service(event?.unitA);
  const b = service(event?.unitB);
  return String(note.note || "")
    .replaceAll("Unit A", a)
    .replaceAll("Unit B", b)
    .replaceAll("a unit", "a service");
}

function noteTime(value) {
  const raw = String(value || "").trim();
  const minute = raw.match(/(\d+)'(?:\+(\d+)')?/);
  if (minute) return state.reveal ? raw : `${minute[1]}${minute[2] ? `+${minute[2]}` : ""}m`;
  if (/final/i.test(raw)) return state.reveal ? "FT" : "done";
  return raw || "pre";
}

function buildSyntheticFeed(events) {
  const sorted = events.slice().sort((a, b) => {
    const rank = { live: 0, closed: 1, queued: 2 };
    return (rank[a.state] ?? 3) - (rank[b.state] ?? 3) || new Date(a.timestamp) - new Date(b.timestamp);
  });

  return sorted.slice(0, 18).map((event, index) => {
    const pair = outputPair(event);
    if (state.reveal) {
      return {
        glyph: event.state === "queued" ? "⏱" : event.state === "live" ? "●" : "✓",
        color: event.state === "live" ? "#3fb950" : event.state === "queued" ? "#d29922" : "#4493f8",
        title: event.state === "queued" ? `Upcoming · ${eventTitle(event)}` : `${statusLabel(event)} · ${eventTitle(event)}`,
        sub: `${pair.left}:${pair.right} · ${phaseMeta(event)}`,
        time: formatShortClock(event.timestamp)
      };
    }

    return {
      glyph: event.state === "queued" ? "…" : event.state === "live" ? "!" : "✓",
      color: event.state === "live" ? "#3fb950" : event.state === "queued" ? "#d29922" : "#4493f8",
      title: event.state === "queued" ? "Pipeline queued" : event.state === "live" ? "Deployment running" : "Deployment completed",
      sub: `${eventTitle(event)} · build ${pair.left}:${pair.right} · ${phaseMeta(event)}`,
      time: formatShortClock(event.timestamp)
    };
  });
}

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width || canvas.width));
  const height = Math.max(1, Math.floor(rect.height || canvas.height));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function seriesFromSeed(seed, length = 24) {
  const values = [];
  let current = ((seed % 57) + 32) / 100;
  for (let index = 0; index < length; index += 1) {
    const raw = Math.sin((seed + 11) * (index + 3) * 12.9898) * 43758.5453;
    const fraction = raw - Math.floor(raw);
    current += (fraction - 0.5) * 0.24;
    current = Math.max(0.08, Math.min(0.95, current));
    values.push(current);
  }
  return values;
}

function drawSpark(canvas, seed, color) {
  const { context, width, height } = canvasContext(canvas);
  const pts = seriesFromSeed(seed, 22);
  const pad = 3;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const x = (index) => pad + (index / (pts.length - 1)) * (width - pad * 2);
  const y = (value) => height - pad - ((value - min) / range) * (height - pad * 2);

  context.clearRect(0, 0, width, height);
  context.beginPath();
  pts.forEach((value, index) => {
    if (index === 0) context.moveTo(x(index), y(value));
    else context.lineTo(x(index), y(value));
  });
  context.lineTo(width - pad, height);
  context.lineTo(pad, height);
  context.closePath();
  context.fillStyle = `${color}22`;
  context.fill();

  context.beginPath();
  pts.forEach((value, index) => {
    if (index === 0) context.moveTo(x(index), y(value));
    else context.lineTo(x(index), y(value));
  });
  context.strokeStyle = color;
  context.lineWidth = 1.8;
  context.lineCap = "round";
  context.stroke();
}

function eventWindowModel(event) {
  const start = 0;
  const end = 100;
  const progress = event.state === "closed" ? 100 : event.state === "queued" ? 0 : minuteValue(event);
  const activeEnd = progress;
  const quality = signalQuality([event]);
  const control = loadSkew([event]);
  const cards = cardTotals(event);
  const pair = outputPair(event);

  return {
    start,
    end,
    activeEnd,
    progress,
    quality,
    control,
    cards,
    outputTotal: (event.unitA?.score || 0) + (event.unitB?.score || 0),
    output: `${pair.left}:${pair.right}`
  };
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, Math.abs(width) / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawTextFit(context, text, x, y, maxWidth) {
  const value = String(text || "");
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }

  let trimmed = value;
  while (trimmed.length > 3 && context.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  context.fillText(`${trimmed}...`, x, y);
}

function drawStatusPill(context, text, x, y, color) {
  context.font = "700 9px IBM Plex Mono, monospace";
  const width = Math.max(42, context.measureText(text).width + 16);
  drawRoundedRect(context, x, y, width, 18, 6);
  context.fillStyle = `${color}22`;
  context.fill();
  context.fillStyle = color;
  context.fillText(text, x + 8, y + 12);
  return width;
}

function drawThroughput(events) {
  const { context, width, height } = canvasContext(elements.throughputCanvas);
  const top = 24;
  const bottom = 24;
  const left = Math.min(180, Math.max(132, width * 0.22));
  const right = Math.min(235, Math.max(174, width * 0.24));
  const plotWidth = width - left - right;
  const sorted = events
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(0, 7);
  const laneCount = Math.max(1, sorted.length);
  const laneHeight = Math.max(30, Math.min(42, (height - top - bottom) / laneCount));
  const barHeight = Math.max(8, Math.min(12, laneHeight * 0.3));
  const x = (percent) => left + (Math.max(0, Math.min(100, percent)) / 100) * plotWidth;
  const statusColor = (event) => event.state === "closed" ? "#3fb950" : event.state === "live" ? "#8b5cf6" : "#d29922";
  const laneModels = [];

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#11161f";
  context.fillRect(0, 0, width, height);

  context.font = "10px IBM Plex Mono, monospace";
  context.strokeStyle = "#1b2330";
  context.lineWidth = 1;
  [
    { position: 0, label: "0 min" },
    { position: 33.333, label: "30 min" },
    { position: 50, label: "HT 45" },
    { position: 66.667, label: "60 min" },
    { position: 100, label: "90+ min" }
  ].forEach((tick) => {
    const xx = x(tick.position);
    context.beginPath();
    context.moveTo(xx, 8);
    context.lineTo(xx, height - bottom + 4);
    context.stroke();
    context.fillStyle = "#586174";
    context.fillText(tick.label, Math.min(xx + 4, width - right - 48), height - 8);
  });

  sorted.forEach((event, index) => {
    const model = eventWindowModel(event);
    const y = top + index * laneHeight;
    const centerY = y + laneHeight / 2 + 2;
    const barY = centerY - barHeight / 2;
    const startX = x(model.start);
    const endX = Math.max(startX + 12, x(model.end));
    const activeEndX = event.state === "queued" ? startX : Math.max(startX + 8, x(model.activeEnd));
    const color = statusColor(event);
    const lane = { event, model, y, height: laneHeight, top: y, bottom: y + laneHeight, startX, endX };
    laneModels.push(lane);

    context.strokeStyle = "#171f2b";
    context.beginPath();
    context.moveTo(0, y + laneHeight - 1);
    context.lineTo(width, y + laneHeight - 1);
    context.stroke();

    context.fillStyle = "#c9d1d9";
    context.font = "700 10px IBM Plex Mono, monospace";
    drawTextFit(context, eventTitle(event), 0, y + 14, left - 14);
    const pillWidth = drawStatusPill(context, statusLabel(event), 0, y + 20, color);
    context.fillStyle = "#586174";
    context.font = "10px IBM Plex Mono, monospace";
    context.fillText(formatShortClock(event.timestamp), pillWidth + 7, y + 32);

    drawRoundedRect(context, startX, barY, endX - startX, barHeight, 5);
    context.fillStyle = event.state === "queued" ? "rgba(210,153,34,0.08)" : "rgba(139,92,246,0.09)";
    context.fill();
    context.strokeStyle = event.state === "queued" ? "rgba(210,153,34,0.32)" : "rgba(139,92,246,0.22)";
    context.setLineDash(event.state === "queued" ? [4, 4] : []);
    context.stroke();
    context.setLineDash([]);

    if (event.state !== "queued") {
      const gradient = context.createLinearGradient(startX, 0, activeEndX, 0);
      gradient.addColorStop(0, "#8b5cf6");
      gradient.addColorStop(1, event.state === "closed" ? "#2dd4bf" : "#a78bfa");
      drawRoundedRect(context, startX, barY, activeEndX - startX, barHeight, 5);
      context.fillStyle = gradient;
      context.fill();
    }

    for (const item of event.outputEvents || []) {
      const markerX = x(outputEventPosition(item));
      context.fillStyle = "#f7c948";
      context.strokeStyle = "#0f1520";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(markerX, centerY, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    for (const item of event.cards?.details || []) {
      const markerX = x(outputEventPosition({ time: item.time }));
      context.fillStyle = item.type === "red" ? "#f85149" : "#f7c948";
      context.fillRect(markerX - 3, barY + barHeight + 5, 6, 9);
    }

    context.fillStyle = "#c9d1d9";
    context.font = "700 10px IBM Plex Mono, monospace";
    const statsX = width - right + 12;
    context.fillText(`out ${model.output}`, statsX, y + 12);
    context.fillStyle = "#8b949e";
    context.font = "10px IBM Plex Mono, monospace";
    context.fillText(`qlt ${model.quality.target}/${model.quality.shots || 0} ${model.quality.rate}%`, statsX, y + 25);
    context.fillText(`ctl ${possessionShare(event, "unitB")}/${possessionShare(event, "unitA")}`, statsX + 88, y + 25);
    context.fillText(`flags Y${model.cards.yellow}/R${model.cards.red} · events ${model.outputTotal}`, statsX, y + 38);
  });

  if (!sorted.length) {
    context.fillStyle = "#8b949e";
    context.font = "12px IBM Plex Mono, monospace";
    context.fillText("No service windows returned for this day.", 16, height / 2);
  }

  state.chartModel = { lanes: laneModels, left, right, top, bottom, width, height, plotWidth };
}

function statusClass(event) {
  if (event.state === "closed") return "passed";
  if (event.state === "queued") return "queued";
  return "running";
}

function pipelineCard(event) {
  const pair = outputPair(event);
  const progress = minuteValue(event);
  const lastEvent = state.reveal
    ? `${event.phase} · ${event.channel}`
    : event.state === "live"
      ? `artifact stream · ${service(event.unitB)} ${event.phase}`
      : "pipeline triggered";

  return `
    <article class="pipeline-card">
      <div class="pipeline-meta">
        <div>
          <span class="pipeline-status"><i></i>${escapeHtml(statusLabel(event))}</span>
          <small>${escapeHtml(phaseMeta(event))}</small>
        </div>
        <small>#${escapeHtml(pseudoHash(event.id))}</small>
      </div>
      <div class="pipeline-score-row">
        <div class="pipeline-team">
          <span class="team-code" style="background:${codeColor(event.unitB.code)}">${escapeHtml(event.unitB.code)}</span>
          <div>
            <strong>${escapeHtml(serviceLabel(event.unitB))}</strong>
            <span>${escapeHtml(subLabel(event.unitB))}</span>
          </div>
        </div>
        <div class="score-pair"><span>${pair.left}</span><i>:</i><span>${pair.right}</span></div>
        <div class="pipeline-team right">
          <div>
            <strong>${escapeHtml(serviceLabel(event.unitA))}</strong>
            <span>${escapeHtml(subLabel(event.unitA))}</span>
          </div>
          <span class="team-code" style="background:${codeColor(event.unitA.code)}">${escapeHtml(event.unitA.code)}</span>
        </div>
      </div>
      ${cardBadges(event)}
      ${forecastStrip(event)}
      <div>
        <div class="progress-track">
          <span class="progress-fill" style="width:${progress}%"></span>
          ${outputMarkers(event)}
        </div>
        <div class="progress-meta"><span>${escapeHtml(lastEvent)}</span><span>${progress}%</span></div>
      </div>
    </article>
  `;
}

function unitMetricLabel(event, unitKey) {
  const unit = event?.[unitKey];
  return state.reveal ? unit?.code || "unit" : service(unit);
}

function possessionShare(event, unitKey) {
  const unit = event?.[unitKey];
  if (Number.isFinite(unit?.possession) && unit.possession > 0) return Math.round(unit.possession);
  if (unitKey === "unitB") return Math.round(event?.splitB || 50);
  return Math.round(event?.splitA || 50);
}

function controlCell(event) {
  const unitBShare = possessionShare(event, "unitB");
  const unitAShare = possessionShare(event, "unitA");
  const skew = loadSkew([event]);
  const leader = skew.skew ? `${skew.leader} +${skew.skew}` : "even";
  return `
    <span class="control-cell">
      <b>${unitBShare}/${unitAShare}</b>
      <small>${escapeHtml(leader)}</small>
    </span>
  `;
}

function completedGoalTimeline(event) {
  if (!(event?.outputEvents || []).length) return "";

  return `
    <div class="detail-timeline">
      <b>${state.reveal ? "goal timeline" : "output timeline"}</b>
      <div class="progress-track detail-progress-track">
        <span class="progress-fill" style="width:100%"></span>
        ${outputMarkers(event, { stackLabels: true })}
      </div>
      <em>100%</em>
    </div>
  `;
}

function completedDetailStrip(event) {
  const quality = signalQuality([event]);
  const unitBShare = possessionShare(event, "unitB");
  const unitAShare = possessionShare(event, "unitA");
  const restarts = `${event.unitB?.corners || 0}:${event.unitA?.corners || 0}`;
  const flags = cardTimesText(event);
  const windowText = event.venue
    ? `${formatClock(event.timestamp)} · ${event.venue}`
    : `${formatClock(event.timestamp)} · ${event.market || event.region}`;

  return `
    <div class="run-detail-strip">
      ${completedGoalTimeline(event)}
      <span class="detail-chip output-detail">
        <b>${state.reveal ? "goals" : "outputs"}</b>
        <span class="output-sequence">${outputEventPills(event)}</span>
      </span>
      <span class="detail-chip"><b>${state.reveal ? "on target" : "quality"}</b>${quality.target}/${quality.shots || 0} · ${quality.rate}%</span>
      <span class="detail-chip"><b>${state.reveal ? "possession" : "control"}</b>${escapeHtml(unitMetricLabel(event, "unitB"))} ${unitBShare} / ${escapeHtml(unitMetricLabel(event, "unitA"))} ${unitAShare}</span>
      <span class="detail-chip"><b>${state.reveal ? "corners" : "restarts"}</b>${restarts}</span>
      <span class="detail-chip"><b>${state.reveal ? "cards" : "flags"}</b>${escapeHtml(flags)}</span>
      ${forecastDetailChip(event)}
      <span class="detail-chip window-chip"><b>window</b>${escapeHtml(windowText)}</span>
    </div>
  `;
}

function runRow(event) {
  const pair = outputPair(event);
  return `
    <div class="run-record">
      <div class="table-grid run-row">
        <span class="status-pill ${statusClass(event)}">${escapeHtml(statusLabel(event))}</span>
        <div class="run-title">
          <span class="mini-code" style="background:${codeColor(event.unitB.code)}">${escapeHtml(event.unitB.code)}</span>
          <span>${escapeHtml(eventTitle(event))}</span>
          <span class="mini-code" style="background:${codeColor(event.unitA.code)}">${escapeHtml(event.unitA.code)}</span>
        </div>
        <span class="build-count">${pair.left}:${pair.right}</span>
        ${cardBadges(event, true)}
        <canvas class="trend" width="120" height="26" data-seed="${escapeHtml(event.id)}"></canvas>
        <span class="duration">${escapeHtml(durationLabel(event))}</span>
        ${controlCell(event)}
      </div>
      ${completedDetailStrip(event)}
    </div>
  `;
}

function queuedRow(event) {
  return `
    <div class="queued-record">
      <div class="table-grid queued-row">
        <span class="status-pill queued">${escapeHtml(statusLabel(event))}</span>
        <div class="run-title">
          <span class="mini-code" style="background:${codeColor(event.unitB.code)}">${escapeHtml(event.unitB.code)}</span>
          <span>${escapeHtml(eventTitle(event))}</span>
          <span class="mini-code" style="background:${codeColor(event.unitA.code)}">${escapeHtml(event.unitA.code)}</span>
        </div>
        <span class="build-count">0:0</span>
        ${cardBadges(event, true)}
        <span class="duration">${escapeHtml(state.reveal ? event.market : event.region)}</span>
        <span class="duration">${escapeHtml(formatClock(event.timestamp))}</span>
        ${controlCell(event)}
      </div>
      ${forecastStrip(event, true)}
    </div>
  `;
}

function drawRowTrends() {
  document.querySelectorAll(".trend").forEach((canvas) => {
    drawSpark(canvas, Number.parseInt(canvas.dataset.seed || "31", 10), "#3fb950");
  });
}

function activityItem(item) {
  return `
    <article class="activity-item">
      <span class="activity-icon" style="background:${item.color}22;color:${item.color}">${escapeHtml(item.glyph)}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.sub)}</small>
      </div>
      <span class="activity-time">${escapeHtml(item.time)}</span>
    </article>
  `;
}

function noteItem(note, event) {
  return `
    <article class="note-item">
      <time>${escapeHtml(noteTime(note.time))}</time>
      <p>${escapeHtml(noteForMode(note, event))}</p>
    </article>
  `;
}

function renderHeader() {
  document.body.classList.toggle("reveal-mode", state.reveal);
  document.title = state.reveal ? "Continuum · Match Day" : "Continuum · Delivery Pipelines";
  elements.headerTitle.textContent = state.reveal ? "World Cup 2026 · Match Day" : "Delivery Pipelines";
  const events = state.payload?.events || [];
  const now = new Date();
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(now);
  const day = selectedDayLabel();
  elements.windowChip.textContent = day.replace(" · ", " ");
  elements.headerSub.textContent = state.reveal
    ? `${day} · live scores · finished · upcoming · ${stamp}`
    : `${day} · ${events.length} tracked services · ${stamp}`;
  elements.modeLabel.textContent = state.reveal ? "Match view" : "Ops view";
  elements.chartTitle.textContent = state.reveal ? "Match operations map · today ET" : "Service runtime map · today ET";
  elements.chartUnit.textContent = state.reveal ? "90-minute lanes · goals · cards · pressure stats" : "90-minute lanes · outputs · flags · telemetry";
  elements.legendPrimary.textContent = state.reveal ? "active window" : "service window";
  elements.legendSecondary.textContent = state.reveal ? "goals/flags" : "outputs/flags";
  elements.liveTitle.textContent = state.reveal ? "Today's Matches" : "Today's Pipelines";
  elements.recentTitle.textContent = state.reveal ? "Full Time · Today" : "Recent Runs · Today";
  elements.queuedTitle.textContent = state.reveal ? "Upcoming · Today" : "Queued · Today";
  elements.feedTitle.textContent = state.reveal ? "Match Events" : "Live Activity";
  elements.kpiOneLabel.textContent = state.reveal ? "Live matches" : "Active pipelines";
  elements.kpiTwoLabel.textContent = state.reveal ? "Matches today" : "Runs · today";
  elements.kpiThreeLabel.textContent = state.reveal ? "Goals today" : "Artifacts deployed";
  elements.oncallLabel.textContent = state.reveal ? "On-call · P. Tierney (ref)" : "On-call · P. Tierney";
}

function renderMetrics() {
  const summary = state.payload?.summary || {};
  const events = state.payload?.events || [];
  const artifacts = events.reduce((sum, event) => sum + (event.unitA?.score || 0) + (event.unitB?.score || 0), 0);
  elements.metricLive.textContent = summary.live || 0;
  elements.metricTotal.textContent = summary.total || 0;
  elements.metricArtifacts.textContent = artifacts;
  elements.artifactDelta.textContent = `+${Math.max(1, Math.round(artifacts / 4))}`;
}

function renderCards() {
  const live = activeEvents();
  const active = live.length ? live : (state.payload?.events || []).filter((event) => event.state !== "closed").slice(0, 4);
  elements.liveRunningBadge.textContent = `${live.length} running`;
  elements.activeGrid.innerHTML = active.length
    ? active.map(pipelineCard).join("")
    : `<div class="empty-card">No active pipelines in the current window.</div>`;
}

function renderTables() {
  const finals = recentEvents();
  const queued = queuedEvents();
  elements.recentMeta.textContent = `${finals.length} completed`;
  elements.recentRuns.innerHTML = finals.length
    ? finals.map(runRow).join("")
    : `<div class="empty-state">No completed runs in the current window.</div>`;
  elements.queuedRuns.innerHTML = queued.length
    ? queued.map(queuedRow).join("")
    : `<div class="empty-state">No queued runs in the current window.</div>`;
  drawRowTrends();
}

function renderActivity() {
  const events = state.payload?.events || [];
  const feed = buildSyntheticFeed(events);
  elements.activityFeed.innerHTML = feed.length
    ? feed.map(activityItem).join("")
    : `<div class="empty-state">No activity returned for this window.</div>`;
}

function renderNotes() {
  const event = candidateForCommentary();
  const notes = state.commentary?.commentary || [];
  elements.notesCount.textContent = notes.length;
  elements.notesList.innerHTML = notes.length
    ? notes.map((note) => noteItem(note, event)).join("")
    : `<div class="empty-state">No signal notes are available for the selected stream.</div>`;
}

function teamServiceName(team) {
  const code = String(team || "svc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 3) || "svc";
  return `${code}-svc`;
}

function forecastLeaderName(row) {
  return state.reveal ? row.team || "Unknown" : teamServiceName(row.team);
}

function forecastLeaderItem(row, index) {
  const pct = Number.isFinite(row.winPct) ? row.winPct : 0;
  return `
    <article class="forecast-leader">
      <span>${index + 1}</span>
      <div>
        <strong>${escapeHtml(forecastLeaderName(row))}</strong>
        <small>${state.reveal ? `Group ${escapeHtml(row.group || "-")}` : `sector ${escapeHtml(row.group || "-")} · Elo ${Math.round(row.elo || 0)}`}</small>
        <i><b style="width:${Math.max(2, Math.min(100, pct * 6))}%"></b></i>
      </div>
      <em>${Number.isFinite(row.winPct) ? row.winPct.toFixed(1) : "--"}%</em>
    </article>
  `;
}

function renderForecastLeaders() {
  if (!elements.forecastList) return;
  const predictionMeta = state.payload?.predictions || {};
  const rows = predictionMeta.tournamentLeaders || [];
  elements.forecastTitle.textContent = "Forecast";
  elements.forecastTitle.title = FORECAST_CREDIT;
  elements.forecastTitle.dataset.credit = FORECAST_CREDIT;
  elements.forecastMeta.textContent = "overall";
  elements.forecastList.innerHTML = rows.length
    ? rows.slice(0, 6).map(forecastLeaderItem).join("")
    : `<div class="empty-state">No forecast feed is available.</div>`;
}

function renderRegions() {
  const events = state.payload?.events || [];
  const counts = new Map();
  events.forEach((event) => {
    counts.set(event.region || "global", (counts.get(event.region || "global") || 0) + 1);
  });
  const rows = [...counts.entries()].slice(0, 5);
  elements.regionsList.innerHTML = rows.length
    ? rows.map(([region, count], index) => {
      const color = index === 2 ? "#d29922" : "#3fb950";
      const status = index === 2 ? "degraded" : "operational";
      return `<div class="region-row"><i style="background:${color}"></i><span>${escapeHtml(region.toLowerCase().replace(/\s+/g, "-"))}</span><span>${status} · ${count}</span></div>`;
    }).join("")
    : `<div class="region-row"><i style="background:#3fb950"></i><span>global</span><span>operational</span></div>`;
}

function renderCharts() {
  const events = state.payload?.events || [];
  const seed = events.reduce((sum, event) => sum + Number(event.id || 0) + (event.signal || 0), 42);
  elements.sparkCanvases.forEach((canvas, index) => {
    drawSpark(canvas, seed + index * 41, ["#4493f8", "#8b5cf6", "#3fb950"][index]);
  });
  drawThroughput(events);
}

function showChartTooltip(event) {
  if (!state.chartModel || !elements.chartTooltip) return;
  const rect = elements.throughputCanvas.getBoundingClientRect();
  const xPos = event.clientX - rect.left;
  const yPos = event.clientY - rect.top;
  const lane = (state.chartModel.lanes || []).find((item) => yPos >= item.top && yPos <= item.bottom);
  if (!lane) {
    hideChartTooltip();
    return;
  }
  const { event: laneEvent, model } = lane;
  const outputEvents = laneEvent.outputEvents?.length ? laneEvent.outputEvents.map(outputEventLabel).join(" · ") : "none";
  const flagText = cardDetailText(laneEvent);
  elements.chartTooltip.innerHTML = `
    <b>${escapeHtml(eventTitle(laneEvent))}</b>
    <small>${escapeHtml(statusLabel(laneEvent))} · ${escapeHtml(formatClock(laneEvent.timestamp))} · ${escapeHtml(model.output)}</small>
    <ul>
      <li><strong>outputs</strong><span>${escapeHtml(outputEvents)}</span><em>${model.outputTotal} total</em></li>
      <li><strong>quality</strong><span>${model.quality.target}/${model.quality.shots || 0}</span><em>${model.quality.rate}% on target</em></li>
      <li><strong>control</strong><span>${escapeHtml(model.control.leader)}</span><em>${model.control.skew}% skew</em></li>
      <li><strong>flags</strong><span>${escapeHtml(flagText)}</span><em>Y${model.cards.yellow}/R${model.cards.red}</em></li>
      ${forecastTooltipRow(laneEvent)}
    </ul>
  `;
  elements.chartTooltip.style.left = `${Math.min(rect.width - 260, Math.max(8, xPos + 14))}px`;
  elements.chartTooltip.style.top = `${Math.max(48, event.clientY - rect.top - 8)}px`;
  elements.chartTooltip.classList.add("visible");
}

function hideChartTooltip() {
  elements.chartTooltip?.classList.remove("visible");
}

function render() {
  renderHeader();
  renderMetrics();
  renderCards();
  renderTables();
  renderActivity();
  renderNotes();
  renderForecastLeaders();
  renderRegions();
  renderCharts();
}

async function loadCommentary() {
  const event = candidateForCommentary();
  if (!event) {
    state.commentary = null;
    state.commentaryFor = "";
    renderNotes();
    return;
  }

  const key = `${event.leagueSlug}:${event.id}`;
  if (state.commentaryFor === key && state.commentary) {
    renderNotes();
    return;
  }

  state.commentaryFor = key;
  state.commentary = null;
  elements.notesCount.textContent = "...";
  elements.notesList.innerHTML = `<div class="empty-state">Loading signal notes for ${escapeHtml(service(event.unitB))} ⇄ ${escapeHtml(service(event.unitA))}.</div>`;

  try {
    const response = await fetch(`/api/commentary?league=${encodeURIComponent(event.leagueSlug)}&event=${encodeURIComponent(event.id)}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Notes returned ${response.status}`);
    state.commentary = await response.json();
  } catch (_error) {
    state.commentary = { commentary: [] };
  }

  renderNotes();
}

async function loadScores() {
  setSyncStatus(null, "Syncing");
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("is-syncing");

  try {
    const response = await fetch(`/api/scores?offset=${state.offset}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    state.payload = await response.json();
    state.sinceRefresh = 0;
    state.commentary = null;
    state.commentaryFor = "";
    render();
    loadCommentary();
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(state.payload.generatedAt));
    setSyncStatus("online", `Synced ${time}`);
  } catch (error) {
    setSyncStatus("offline", "Sync failed");
    elements.activeGrid.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}</div>`;
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("is-syncing");
  }
}

function tickClock() {
  state.sinceRefresh += 1;
  elements.updatedLabel.textContent = `updated ${state.sinceRefresh}s ago`;
  elements.refreshBar.style.width = `${Math.min(100, Math.round((state.sinceRefresh / 45) * 100))}%`;
  renderHeader();
}

function activateButton(selector, target) {
  document.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("active", button === target);
  });
}

document.querySelectorAll("[data-offset]").forEach((button) => {
  button.addEventListener("click", () => {
    state.offset = Number(button.dataset.offset);
    activateButton("[data-offset]", button);
    loadScores();
  });
});

elements.modeToggle.addEventListener("click", () => {
  state.reveal = !state.reveal;
  render();
});

elements.refreshButton.addEventListener("click", loadScores);
elements.throughputCanvas.addEventListener("mousemove", showChartTooltip);
elements.throughputCanvas.addEventListener("mouseleave", hideChartTooltip);

window.addEventListener("resize", () => {
  if (state.payload) renderCharts();
});

loadScores();
state.timer = window.setInterval(loadScores, 45_000);
state.clock = window.setInterval(tickClock, 1000);
