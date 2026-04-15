# Lighthouse MCP Server

An MCP server that runs Google Lighthouse audits and returns performance scores, Core Web Vitals, optimization opportunities, and diagnostics. Designed to be deployed as a hosted HTTP service — no local setup needed for users.

## How It Works

```
Claude Code --MCP HTTP--> This service --Lighthouse--> Target URL
                          (headless Chrome)
```

The service launches headless Chromium, runs a Lighthouse audit on the given URL, and returns structured JSON results. It does NOT touch the target server — it only visits the URL like a normal browser.

## Deploy

### Option A: Railway (simplest)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app), create new project, connect the repo
3. Railway auto-detects the Dockerfile and deploys
4. Copy the generated URL (e.g. `https://lighthouse-mcp-production-xxxx.up.railway.app`)

### Option B: Google Cloud Run

```bash
gcloud run deploy lighthouse-mcp \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 120
```

### Option C: Any Docker host

```bash
docker build -t lighthouse-mcp .
docker run -p 3000:3000 lighthouse-mcp
```

## Connect to Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "lighthouse": {
    "type": "http",
    "url": "https://YOUR-DEPLOYED-URL/mcp"
  }
}
```

Replace `YOUR-DEPLOYED-URL` with your Railway/Cloud Run/custom URL.

Restart Claude Code. The `run_lighthouse_audit` tool will appear automatically.

## API

### Health Check

```
GET /health
```

Returns `{"status": "ok", "service": "lighthouse-mcp"}`

### MCP Endpoint

```
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream
```

Standard MCP Streamable HTTP protocol. The server exposes one tool:

**run_lighthouse_audit**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | Full URL to audit |
| categories | string[] | No | Categories to audit. Default: `["performance"]`. Options: performance, accessibility, best-practices, seo |

**Returns:**

```json
{
  "scores": { "performance": 72 },
  "metrics": {
    "first-contentful-paint": { "value": 1200, "score": 0.95, "display": "1.2 s" },
    "largest-contentful-paint": { "value": 2800, "score": 0.65, "display": "2.8 s" },
    "cumulative-layout-shift": { "value": 0.05, "score": 0.98, "display": "0.05" },
    "total-blocking-time": { "value": 150, "score": 0.88, "display": "150 ms" },
    "speed-index": { "value": 2100, "score": 0.78, "display": "2.1 s" },
    "interactive": { "value": 3200, "score": 0.72, "display": "3.2 s" }
  },
  "opportunities": [
    { "id": "render-blocking-resources", "title": "Eliminate render-blocking resources", "savings_ms": 450 }
  ],
  "diagnostics": [
    { "id": "largest-contentful-paint-element", "title": "Largest Contentful Paint element" }
  ]
}
```

## Local Development

```bash
npm install
node server.js
# Listening on http://localhost:3000
```

Requires Chrome/Chromium installed locally. Set `CHROME_PATH` env var if it's not in the default location.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | HTTP port to listen on |
| CHROME_PATH | (auto-detect) | Path to Chrome/Chromium binary |
