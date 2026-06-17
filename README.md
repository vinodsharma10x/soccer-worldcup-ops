# Soccer Worldcup Ops

A professional operations-style dashboard that displays live soccer schedule and score data as CI/CD pipeline telemetry.

The default view masks teams as services like `esp-svc`, `arg-svc`, and `fra-svc`, so it looks like a delivery/observability dashboard. A reveal toggle switches the labels back to match-day language.

## Features

- Pulls World Cup match data from ESPN public scoreboard endpoints
- Filters "today" by `America/New_York` time
- Shows live, finished, and upcoming matches as operational pipeline states
- Includes a refresh button and auto-refresh timer
- Provides chart hover details for the Eastern-time match timeline
- Pulls available ESPN commentary into neutral "signal notes"
- Includes a Cloudflare Worker-compatible build for Sites-style hosting

## Run Locally

```bash
npm start
```

Open `http://localhost:4187`.

Use another port if needed:

```bash
PORT=4190 npm start
```

## Build

```bash
npm run build
```

The build output is written to `dist/` with:

- `dist/server/index.js`
- `dist/server/public/*`
- `dist/.openai/hosting.json`

## Data Source

This project uses ESPN public site APIs for soccer scoreboards and match summaries. It does not require an API key.

## License

MIT
