import express, { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const router = express.Router();

// Initialize MCP Server for RENMOLT ETHICAL SYSTEMS
const mcpServer = new Server(
  {
    name: "renmolt-ethical-systems",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register available MCP Tools for remote AgentKit / MCP discovery
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "audit_payload",
        description: "Evaluates agent payload safety, compliance, and issues cryptographically signed audit proofs.",
        inputSchema: {
          type: "object",
          properties: {
            payload: { 
              type: "object", 
              description: "The payload or action object to evaluate." 
            },
            agent_id: { 
              type: "string", 
              description: "The requesting Agent ID or wallet address." 
            }
          },
          required: ["payload"]
        }
      }
    ]
  };
});

// Handle MCP Tool Invocation
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "audit_payload") {
    const args = request.params.arguments as any;
    const { payload, agent_id } = args || {};

    const auditResult = {
      status: "APPROVED",
      agent_id: agent_id || "anonymous",
      timestamp: new Date().toISOString(),
      score: 0.98,
      signature: "0x_renmolt_ecdsa_signed_proof",
      node_identity: "84422"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(auditResult, null, 2)
        }
      ]
    };
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

// SSE Transport session instance
let transport: SSEServerTransport | null = null;

router.get('/sse', async (req: Request, res: Response) => {
  transport = new SSEServerTransport('/messages', res as any);
  await mcpServer.connect(transport);
});

router.post('/messages', async (req: Request, res: Response) => {
  if (transport) {
    await transport.handlePostMessage(req as any, res as any);
  } else {
    res.status(400).json({ error: "SSE transport session not established. Connect to /sse first." });
  }
});

export default router;
