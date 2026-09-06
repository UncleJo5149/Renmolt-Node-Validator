const http = require("node:http");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_MODEL = process.env.XAI_MODEL || "grok-4.6";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function analyzeXai(filename, text) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + XAI_API_KEY,
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
          content: "Document: " + filename + "\n\n" + String(text).slice(0, 5000),
        },
      ],
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("xAI HTTP " + response.status + ": " + raw.slice(0, 300));
  const data = JSON.parse(raw);
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}

async function analyzeGemini(filename, text) {
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
              text:
                'You are a compliance reviewer. Return JSON only: {"status":"Passed"|"Flagged"|"Failed","report":"short reason"}\n\nDocument: ' +
                filename +
                "\n\n" +
                String(text).slice(0, 5000),
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("Gemini HTTP " + response.status + ": " + raw.slice(0, 300));
  const data = JSON.parse(raw);
  const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(textOut);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    send(res, 200, {
      status: "online",
      service: "renmolt-node",
      version: "1.2.0",
      brain: XAI_API_KEY ? "xai" : GEMINI_API_KEY ? "gemini" : "none",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/verify") {
    try {
      const body = await readBody(req);
      if (!body.text) {
        send(res, 400, { error: "No text provided" });
        return;
      }
      if (!XAI_API_KEY && !GEMINI_API_KEY) {
        send(res, 500, { error: "Set XAI_API_KEY or GEMINI_API_KEY" });
        return;
      }
      const result = XAI_API_KEY
        ? await analyzeXai(body.filename || "untitled", body.text)
        : await analyzeGemini(body.filename || "untitled", body.text);
      send(res, 200, { success: true, result });
    } catch (e) {
      console.error(e);
      send(res, 500, { error: e.message || String(e) });
    }
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[RENMOLT] listening 0.0.0.0:" + PORT);
});
