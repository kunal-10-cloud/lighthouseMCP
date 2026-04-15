import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { createServer } from "http";

const server = new McpServer({
  name: "lighthouse-mcp",
  version: "1.0.0",
});

server.tool(
  "run_lighthouse_audit",
  "Run a Google Lighthouse audit on a URL. Returns performance scores, Core Web Vitals metrics, optimization opportunities, and diagnostics. Does NOT install anything on the target server — only visits the URL like a normal browser.",
  {
    url: z
      .string()
      .url()
      .describe(
        "The full URL to audit (e.g. https://my-app.preview.emergentagent.com)"
      ),
    categories: z
      .array(
        z.enum(["performance", "accessibility", "best-practices", "seo"])
      )
      .default(["performance"])
      .describe("Lighthouse categories to audit. Default: performance only."),
  },
  async ({ url, categories }) => {
    let chrome;
    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-software-rasterizer",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--no-first-run",
          "--js-flags=--max-old-space-size=256",
        ],
        chromePath: process.env.CHROME_PATH || undefined,
      });

      const result = await lighthouse(url, {
        logLevel: "error",
        output: "json",
        onlyCategories: categories,
        port: chrome.port,
        screenEmulation: { disabled: true },
        throttling: {
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
        },
      });

      const report = JSON.parse(result.report);

      const scores = {};
      for (const [key, cat] of Object.entries(report.categories || {})) {
        scores[key] = Math.round((cat.score || 0) * 100);
      }

      const metricIds = [
        "first-contentful-paint",
        "largest-contentful-paint",
        "cumulative-layout-shift",
        "total-blocking-time",
        "speed-index",
        "interactive",
      ];
      const metrics = {};
      for (const id of metricIds) {
        const audit = report.audits?.[id];
        if (audit) {
          metrics[id] = {
            value: Math.round(audit.numericValue || 0),
            score: audit.score,
            display: audit.displayValue || "",
          };
        }
      }

      const opportunities = [];
      for (const audit of Object.values(report.audits || {})) {
        if (
          audit.details?.type === "opportunity" &&
          audit.details?.overallSavingsMs > 0
        ) {
          opportunities.push({
            id: audit.id,
            title: audit.title,
            savings_ms: Math.round(audit.details.overallSavingsMs),
            description: audit.description || "",
          });
        }
      }
      opportunities.sort((a, b) => b.savings_ms - a.savings_ms);

      const diagnosticIds = [
        "largest-contentful-paint-element",
        "layout-shifts",
        "long-tasks",
        "dom-size",
        "critical-request-chains",
        "render-blocking-resources",
        "uses-responsive-images",
        "offscreen-images",
        "unminified-javascript",
        "unminified-css",
        "unused-javascript",
        "unused-css-rules",
      ];
      const diagnostics = [];
      for (const id of diagnosticIds) {
        const audit = report.audits?.[id];
        if (audit && audit.score !== null && audit.score < 1) {
          diagnostics.push({
            id: audit.id,
            title: audit.title,
            score: audit.score,
            display: audit.displayValue || "",
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                url,
                scores,
                metrics,
                opportunities: opportunities.slice(0, 10),
                diagnostics: diagnostics.slice(0, 10),
                lighthouse_version: report.lighthouseVersion,
                fetch_time: report.fetchTime,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: true, message: err.message, url }),
          },
        ],
        isError: true,
      };
    } finally {
      if (chrome) {
        try {
          await chrome.kill();
        } catch (_) {}
      }
    }
  }
);

// --- HTTP Transport ---

const PORT = parseInt(process.env.PORT || "3000", 10);
const sessions = new Map();

const httpServer = createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "lighthouse-mcp" }));
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
    const sessionId = req.headers["mcp-session-id"];

    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () =>
        `lh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });

    transport.onclose = () => {
      const id = [...sessions.entries()].find(
        ([, t]) => t === transport
      )?.[0];
      if (id) sessions.delete(id);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // Fallback
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  console.log(`lighthouse-mcp listening on port ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  MCP:    http://localhost:${PORT}/mcp`);

  // Self-ping every 14 minutes to prevent free-tier spin-down (Render, etc.)
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SERVICE_URL;
  if (SELF_URL) {
    const PING_INTERVAL = 14 * 60 * 1000;
    setInterval(() => {
      fetch(`${SELF_URL}/health`).catch(() => {});
    }, PING_INTERVAL);
    console.log(`  Self-ping: every 14m -> ${SELF_URL}/health`);
  }
});
