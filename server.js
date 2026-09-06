import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.6";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const app = express();
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "online",
    service: "renmolt-node",
    version: "1.1.0",
    brain: XAI_API_KEY ? "xai" : GEMINI_API_KEY ? "gemini" : "none",
    timestamp: new Date().toISOString(),
  });
});

app.get("/status", (_req, res) => {
  res.json({ status: "ok", service: "renmolt-node" });
});

app.get("/", (_req, res) => {
  res.json({
    service: "RENMOLT ETHICAL SYSTEMS",
    health: "/health",
    verify: "POST /api/verify",
  });
});

class SimpleQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.pending = 0;
    this.waiting = [];
  }
  async add(fn) {
    if (this.pending >= this.concurrency) {
      await new Promise((resolve) => this.waiting.push(resolve));
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

const queue = new SimpleQueue(3);

async function analyzeWithXai(filename, text) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You are a compliance reviewer. Return JSON only: {"status":"Passed"|"Flagged"|"Failed","report":"short reason"}',
        },
        {
          role: "user",
          content: `Document: ${filename}\n\n${String(text).slice(0, 5000)}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`xAI HTTP ${response.status}: ${body.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function analyzeWithGemini(filename, text) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `You are a compliance reviewer. Return JSON only: {"status":"Passed"|"Flagged"|"Failed","report":"short reason"}\n\nDocument: ${filename}\n\n${String(text).slice(0, 5000)}`,
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(raw);
}

app.post("/api/verify", async (req, res) => {
  try {
    const { text, filename } = req.body || {};
    if (!text) {
      res.status(400).json({ error: "No text provided" });
      return;
    }
    if (!XAI_API_KEY && !GEMINI_API_KEY) {
      res.status(500).json({ error: "Set XAI_API_KEY or GEMINI_API_KEY on Railway" });
      return;
    }
    const result = await queue.add(async () => {
      if (XAI_API_KEY) return analyzeWithXai(filename || "untitled", text);
      return analyzeWithGemini(filename || "untitled", text);
    });
    res.json({ success: true, result });
  } catch (e) {
    console.error(e);
    res.status(e.status === 429 ? 429 : 500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[RENMOLT] listening 0.0.0.0:${PORT}`);
});
