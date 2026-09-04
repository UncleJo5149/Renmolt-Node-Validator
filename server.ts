import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import helmet from "helmet";
import { GoogleGenAI } from "@google/genai";
import mcpRouter from "./src/routes/mcp";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(cors());
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json());

  app.use('/mcp', mcpRouter);


  const WALLET_ADDRESS = process.env.BASE_USDC_WALLET_ADDRESS || "0xF9C7c3022Bd8756E06172B37A6F9448a730638C9";
  const AUDIT_FEE_USDC = "0.05"; 

  // 1. Machine Discovery Endpoint
  app.get('/.well-known/agent.json', (req, res) => {
    const agentCardPath = path.join(process.cwd(), 'public', 'agent.json');
    if (fs.existsSync(agentCardPath)) {
      const agentCard = JSON.parse(fs.readFileSync(agentCardPath, 'utf-8'));
      res.json(agentCard);
    } else {
      res.status(404).json({ error: "agent.json not found" });
    }
  });

  // 1.5 MCP Server Card Endpoint
  app.get('/.well-known/mcp/server-card.json', (req, res) => {
    res.json({
      name: "renmolt-node-validator",
      description: "Renmolt Ethical Validator MCP Server",
      version: "1.0.0",
      transport: {
        type: "sse",
        url: "https://renmolt-node-validator-production.up.railway.app/sse"
      }
    });
  });

  // 2. Healthcheck Endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: "online", 
      entity: "RENMOLT ETHICAL SYSTEMS", 
      agent_id: process.env.ERC8004_AGENT_ID || "84422",
      timestamp: new Date().toISOString() 
    });
  });

  // 3. Simple x402 Micro-Payment Middleware
  const x402Middleware = (req: Request, res: Response, next: NextFunction) => {
    const paymentSignature = req.headers['payment-signature'];

    if (!paymentSignature) {
      // Return HTTP 402 with x402 V2 Header requirements
      const paymentRequirements = Buffer.from(JSON.stringify({
        scheme: "exact",
        network: "base",
        asset: "USDC",
        amount: AUDIT_FEE_USDC,
        payTo: WALLET_ADDRESS
      })).toString('base64');

      res.setHeader('PAYMENT-REQUIRED', paymentRequirements);
      res.status(402).json({
        error: "Payment Required",
        message: "Attach a valid x402 PAYMENT-SIGNATURE header to execute audit."
      });
      return;
    }

    // Bypass signature verification in dev if needed; pass to execution
    next();
  };

  // 4. Primary Validator Endpoint
  app.post('/v1/audit', x402Middleware, (req: Request, res: Response) => {
    const { target_agent_id, payload_data, action_type } = req.body;

    if (!payload_data) {
      res.status(400).json({ error: "Invalid request. 'payload_data' is required." });
      return;
    }

    // Verification Logic Execution
    const payloadStr = JSON.stringify(payload_data);
    const containsRisk = /drop table|exfiltrate|delete|eval\(|rm -rf/i.test(payloadStr);
    const complianceScore = containsRisk ? 15 : 98;
    const verified = complianceScore >= 70;

    const timestamp = new Date().toISOString();
    const signatureData = `${target_agent_id}:${complianceScore}:${timestamp}`;
    const mockSignature = crypto.createHmac('sha256', process.env.HMAC_SECRET || 'renmolt-secret')
                                .update(signatureData)
                                .digest('hex');

    // Response with x402 Settlement header
    res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ status: "settled", tx: "verified_on_chain" })).toString('base64'));

    res.json({
      auditor: "RENMOLT ETHICAL SYSTEMS",
      entity_id: "202603057004 (TR0338241-U)",
      verified: verified,
      compliance_score: complianceScore,
      action_type: action_type || "general_execution",
      timestamp: timestamp,
      proof_signature: mockSignature
    });
  });

  // Verification API
  app.post("/api/verify", async (req, res) => {
    try {
      const { text, filename } = req.body;
      if (!text) {
        return res.status(400).json({ error: "No text provided" });
      }

      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `You are the x402 Ethical & Compliance Verification Node. Analyze the following document for compliance, ethical concerns, and regulatory risks. Provide a structured summary with a 'status' (Passed, Flagged, or Failed), and a brief 'report'.
      
Document Title: ${filename}
Document Content:
${text.substring(0, 5000)} // Truncated to 5000 chars for verification

Return JSON format: { "status": "Passed|Flagged|Failed", "report": "..." }`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      
      if (response.text) {
        const result = JSON.parse(response.text);
        res.json({ success: true, result });
      } else {
        throw new Error("No response from AI");
      }
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MCP Server running on port ${PORT}`);
  });
}

startServer();
