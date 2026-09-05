import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import helmet from "helmet";
import { GoogleGenAI } from "@google/genai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tiny concurrency limiter. Replaces p-queue so the production
 * bundle does not import an ESM-only package from a host start script.
 */
class SimpleQueue {
  private pending = 0;
  private waiting: Array<() => void> = [];
  private onAdd?: (waiting: number) => void;

  constructor(private concurrency: number, onAdd?: (waiting: number) => void) {
    this.onAdd = onAdd;
  }

  get size() {
    return this.waiting.length;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    this.onAdd?.(this.waiting.length + (this.pending >= this.concurrency ? 1 : 0));
    if (this.pending >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.pending += 1;
    try {
      return await fn();
    } finally {
      this.pending -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  const isProd = process.env.NODE_ENV === "production";

  app.use(cors());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: "2mb" }));

  if (!process.env.GEMINI_API_KEY) {
    console.warn("[RENMOLT] GEMINI_API_KEY is not set. /health will stay up; /api/verify will fail.");
  }

  // ==========================================
  // 1. MCP SERVER INITIALIZATION
  // ==========================================
  const mcpServer = new Server(
    {
      name: "renmolt-ethical-validator",
      version: "1.0.1",
    },
    {
      capabilities: { tools: {} },
    }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "validate_node",
          description: "Validate node compliance and ethics rules",
          inputSchema: {
            type: "object",
            properties: {
              nodeId: { type: "string", description: "The ID of the node to validate" },
            },
            required: ["nodeId"],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "validate_node") {
      const args = request.params.arguments as { nodeId?: string };
      const { nodeId } = args || {};

      const auditResult = {
        status: "APPROVED",
        nodeId: nodeId || "anonymous",
        timestamp: new Date().toISOString(),
        score: 0.98,
        signature: "0x_renmolt_ecdsa_signed_proof",
        node_identity: "84422",
        note: "Prototype response. Policy engine not enforced yet.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(auditResult, null, 2) }],
      };
    }
    throw new Error(`Tool not found: ${request.params.name}`);
  });

  let transport: SSEServerTransport | null = null;

  // ==========================================
  // 2. REQUIRED ROUTES (Railway & Smithery)
  // ==========================================
  // Do not bind GET / to JSON — that hid the UI and confused browsers.
  app.get("/status", (_req, res) => {
    res.status(200).json({ status: "ok", service: "renmolt-ethical-validator", version: "1.0.1" });
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "online",
      entity: "RENMOLT ETHICAL SYSTEMS",
      agent_id: process.env.ERC8004_AGENT_ID || "84422",
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.status(200).json({
      $schema: "https://schema.smithery.ai/server-card.json",
      serverInfo: {
        name: "renmolt-ethical-validator",
        version: "1.0.1",
      },
      tools: [
        {
          name: "validate_node",
          description: "Validate node compliance and ethics rules for specified node IDs",
          inputSchema: {
            type: "object",
            properties: {
              nodeId: {
                type: "string",
                description: "The unique identifier of the target node to validate",
              },
            },
            required: ["nodeId"],
          },
          outputSchema: {
            type: "object",
            properties: {
              isValid: { type: "boolean" },
              score: { type: "number" },
              details: { type: "string" },
            },
            required: ["isValid", "score"],
          },
          annotations: {
            readOnly: true,
            destructive: false,
            idempotent: true,
            openWorld: false,
          },
        },
      ],
    });
  });

  app.get("/sse", async (_req: Request, res: Response) => {
    transport = new SSEServerTransport("/messages", res as any);
    await mcpServer.connect(transport);
  });

  app.post("/messages", async (req: Request, res: Response) => {
    if (transport) {
      await transport.handlePostMessage(req as any, res as any);
    } else {
      res.status(400).json({ error: "SSE transport session not established. Connect to /sse first." });
    }
  });

  // ==========================================
  // 3. EXISTING APP ROUTES
  // ==========================================
  const WALLET_ADDRESS =
    process.env.BASE_USDC_WALLET_ADDRESS || "0xF9C7c3022Bd8756E06172B37A6F9448a730638C9";
  const AUDIT_FEE_USDC = "0.05";

  app.get("/.well-known/agent.json", (_req, res) => {
    const agentCardPath = path.join(process.cwd(), "public", "agent.json");
    if (fs.existsSync(agentCardPath)) {
      res.json(JSON.parse(fs.readFileSync(agentCardPath, "utf-8")));
    } else {
      res.status(404).json({ error: "agent.json not found" });
    }
  });

  const x402Middleware = (req: Request, res: Response, next: NextFunction) => {
    const paymentSignature = req.headers["payment-signature"];
    if (!paymentSignature) {
      const paymentRequirements = Buffer.from(
        JSON.stringify({
          scheme: "exact",
          network: "base",
          asset: "USDC",
          amount: AUDIT_FEE_USDC,
          payTo: WALLET_ADDRESS,
        })
      ).toString("base64");
      res.setHeader("PAYMENT-REQUIRED", paymentRequirements);
      res.status(402).json({
        error: "Payment Required",
        message: "Attach a valid x402 PAYMENT-SIGNATURE header to execute audit.",
      });
      return;
    }
    next();
  };

  app.post("/v1/audit", x402Middleware, (req: Request, res: Response) => {
    const { target_agent_id, payload_data, action_type } = req.body;
    if (!payload_data) {
      res.status(400).json({ error: "Invalid request. 'payload_data' is required." });
      return;
    }

    const containsRisk = /drop table|exfiltrate|delete|eval\(|rm -rf/i.test(
      JSON.stringify(payload_data)
    );
    const complianceScore = containsRisk ? 15 : 98;
    const verified = complianceScore >= 70;
    const timestamp = new Date().toISOString();
    const signatureData = `${target_agent_id}:${complianceScore}:${timestamp}`;
    const mockSignature = crypto
      .createHmac("sha256", process.env.HMAC_SECRET || "renmolt-secret")
      .update(signatureData)
      .digest("hex");

    res.setHeader(
      "PAYMENT-RESPONSE",
      Buffer.from(JSON.stringify({ status: "header_present_not_settled", tx: "unverified" })).toString(
        "base64"
      )
    );
    res.json({
      auditor: "RENMOLT ETHICAL SYSTEMS",
      entity_id: "202603057004 (TR0338241-U)",
      verified,
      compliance_score: complianceScore,
      action_type: action_type || "general_execution",
      timestamp,
      proof_signature: mockSignature,
      settlement: "unverified",
    });
  });

  // ==========================================
  // 4. QUEUE & ALERT NOTIFICATION SYSTEM
  // ==========================================
  let lastAlertTime = 0;
  const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

  async function notifyAdmin(title: string, message: string) {
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN_MS) return;
    lastAlertTime = now;

    console.warn(`\n[SYSTEM ALERT] ${title}`);
    console.warn(`[DETAILS] ${message}\n`);

    const webhookUrl = process.env.DISCORD_OR_SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `**${title}**\n${message}` }),
        });
      } catch (err) {
        console.error("[RENMOLT] Failed to send webhook alert:", err);
      }
    }
  }

  const geminiQueue = new SimpleQueue(3, (waiting) => {
    if (waiting > 15) {
      notifyAdmin(
        "High Traffic Alert",
        `The Gemini API verification queue is backing up. Current queue waiting size: ${waiting}. Expect delayed responses for clients.`
      );
    }
  });

  app.post("/api/verify", async (req, res) => {
    try {
      const { text, filename } = req.body;
      if (!text) {
        res.status(400).json({ error: "No text provided" });
        return;
      }
      if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are the x402 Ethical & Compliance Verification Node. Analyze the following document for compliance, ethical concerns, and regulatory risks. Provide a structured summary with a 'status' (Passed, Flagged, or Failed), and a brief 'report'.
      
Document Title: ${filename}
Document Content:
${String(text).substring(0, 5000)}

Return JSON format: { "status": "Passed|Flagged|Failed", "report": "..." }`;

      const result = await geminiQueue.add(async () => {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });
          if (response.text) {
            return JSON.parse(response.text);
          }
          throw new Error("No response from AI");
        } catch (apiError: any) {
          if (apiError?.status === 429 || apiError?.message?.includes("429")) {
            notifyAdmin(
              "Gemini API Rate Limit / Quota Hit",
              "The application just received a 429 Too Many Requests error from Gemini. The queue might be too aggressive or your quota is exhausted."
            );
          }
          throw apiError;
        }
      });

      res.json({ success: true, result });
    } catch (e: any) {
      console.error(e);
      res.status(e.status === 429 ? 429 : 500).json({ error: e.message || String(e) });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/v1") || req.path.startsWith("/sse") || req.path.startsWith("/messages") || req.path.startsWith("/.well-known")) {
        return next();
      }
      const indexFile = path.join(distPath, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(200).json({ status: "ok", service: "renmolt-ethical-validator" });
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[RENMOLT] Server listening on 0.0.0.0:${PORT} env=${process.env.NODE_ENV || "development"}`);
    console.log(`[RENMOLT] Health: http://0.0.0.0:${PORT}/health`);
    console.log(`[RENMOLT] SSE:    http://0.0.0.0:${PORT}/sse`);
  });
}

startServer().catch((err) => {
  console.error("[RENMOLT] Fatal startup error:", err);
  process.exit(1);
});
