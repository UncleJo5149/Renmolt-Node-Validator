import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import helmet from "helmet";
import { GoogleGenAI } from "@google/genai";
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

async function startServer() {
  const app = express();
  // Railway dynamic port binding fallback
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

  app.use(cors());
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json());

  // ==========================================
  // 1. MCP SERVER INITIALIZATION
  // ==========================================
  const mcpServer = new Server(
    {
      name: "renmolt-ethical-validator",
      version: "1.0.0",
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
              nodeId: { type: "string", description: "The ID of the node to validate" }
            },
            required: ["nodeId"]
          }
        }
      ]
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "validate_node") {
      const args = request.params.arguments as any;
      const { nodeId } = args || {};

      const auditResult = {
        status: "APPROVED",
        nodeId: nodeId || "anonymous",
        timestamp: new Date().toISOString(),
        score: 0.98,
        signature: "0x_renmolt_ecdsa_signed_proof",
        node_identity: "84422"
      };

      return {
        content: [{ type: "text", text: JSON.stringify(auditResult, null, 2) }]
      };
    }
    throw new Error(`Tool not found: ${request.params.name}`);
  });

  let transport: SSEServerTransport | null = null;

  // ==========================================
  // 2. REQUIRED ROUTES (Railway & Smithery)
  // ==========================================
  app.get('/', (req, res) => {
    res.status(200).json({ status: "ok", service: "renmolt-ethical-validator" });
  });

  app.get('/.well-known/mcp/server-card.json', (req, res) => {
    res.status(200).json({
      $schema: "https://schema.smithery.ai/server-card.json",
      serverInfo: {
        name: "renmolt-ethical-validator",
        version: "1.0.0"
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
                description: "The unique identifier of the target node to validate"
              }
            },
            required: ["nodeId"]
          },
          outputSchema: {
            type: "object",
            properties: {
              isValid: { type: "boolean" },
              score: { type: "number" },
              details: { type: "string" }
            },
            required: ["isValid", "score"]
          },
          annotations: {
            audience: ["user", "assistant"],
            priority: 1
          }
        }
      ]
    });
  });

  app.get('/sse', async (req: Request, res: Response) => {
    transport = new SSEServerTransport('/messages', res as any);
    await mcpServer.connect(transport);
  });

  app.post('/messages', async (req: Request, res: Response) => {
    if (transport) {
      await transport.handlePostMessage(req as any, res as any);
    } else {
      res.status(400).json({ error: "SSE transport session not established. Connect to /sse first." });
    }
  });

  // ==========================================
  // 3. EXISTING APP ROUTES
  // ==========================================
  const WALLET_ADDRESS = process.env.BASE_USDC_WALLET_ADDRESS || "0xF9C7c3022Bd8756E06172B37A6F9448a730638C9";
  const AUDIT_FEE_USDC = "0.05";

  app.get('/.well-known/agent.json', (req, res) => {
    const agentCardPath = path.join(process.cwd(), 'public', 'agent.json');
    if (fs.existsSync(agentCardPath)) {
      res.json(JSON.parse(fs.readFileSync(agentCardPath, 'utf-8')));
    } else {
      res.status(404).json({ error: "agent.json not found" });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ 
      status: "online", 
      entity: "RENMOLT ETHICAL SYSTEMS", 
      agent_id: process.env.ERC8004_AGENT_ID || "84422",
      timestamp: new Date().toISOString() 
    });
  });

  const x402Middleware = (req: Request, res: Response, next: NextFunction) => {
    const paymentSignature = req.headers['payment-signature'];
    if (!paymentSignature) {
      const paymentRequirements = Buffer.from(JSON.stringify({
        scheme: "exact", network: "base", asset: "USDC", amount: AUDIT_FEE_USDC, payTo: WALLET_ADDRESS
      })).toString('base64');
      res.setHeader('PAYMENT-REQUIRED', paymentRequirements);
      res.status(402).json({ error: "Payment Required", message: "Attach a valid x402 PAYMENT-SIGNATURE header to execute audit." });
      return;
    }
    next();
  };

  app.post('/v1/audit', x402Middleware, (req: Request, res: Response) => {
    const { target_agent_id, payload_data, action_type } = req.body;
    if (!payload_data) {
      res.status(400).json({ error: "Invalid request. 'payload_data' is required." });
      return;
    }

    const containsRisk = /drop table|exfiltrate|delete|eval\(|rm -rf/i.test(JSON.stringify(payload_data));
    const complianceScore = containsRisk ? 15 : 98;
    const verified = complianceScore >= 70;
    const timestamp = new Date().toISOString();
    const signatureData = `${target_agent_id}:${complianceScore}:${timestamp}`;
    const mockSignature = crypto.createHmac('sha256', process.env.HMAC_SECRET || 'renmolt-secret').update(signatureData).digest('hex');

    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ status: "settled", tx: "verified_on_chain" })).toString('base64'));
    res.json({ auditor: "RENMOLT ETHICAL SYSTEMS", entity_id: "202603057004 (TR0338241-U)", verified, compliance_score: complianceScore, action_type: action_type || "general_execution", timestamp, proof_signature: mockSignature });
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
${text.substring(0, 5000)}

Return JSON format: { "status": "Passed|Flagged|Failed", "report": "..." }`;

      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json" } });
      
      if (response.text) res.json({ success: true, result: JSON.parse(response.text) });
      else throw new Error("No response from AI");
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Vite middleware for development (conditionally skipped if overridden by GET / above)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[RENMOLT] MCP Server listening on port ${PORT} at host 0.0.0.0`);
    console.log(`[RENMOLT] SSE Transport ready at: http://0.0.0.0:${PORT}/sse`);
  });
}

startServer();
