import { createServer } from "node:http";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const HF_API_KEY = process.env.HF_API_KEY || "";
const MODEL = process.env.HF_MODEL || "meta-llama/Llama-2-7b-chat-hf";

const jsonResponse = (res, status, payload) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
};

const parseJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const buildPrompt = (input) => {
  return `You are Barangay Kolabtingon's friendly virtual assistant. Answer in a helpful, clear manner, and keep replies short. Use English or Cebuano if it fits the question.

User: ${input}
Assistant:`;
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return jsonResponse(res, 204, {});
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    const payload = await parseJsonBody(req);
    if (!payload || typeof payload.input !== "string") {
      return jsonResponse(res, 400, { error: "Request body must include { input: string }." });
    }

    if (!HF_API_KEY) {
      return jsonResponse(res, 200, {
        reply:
          "The chat backend is active, but a Hugging Face API key is not configured. Set HF_API_KEY in your environment and restart the backend.",
      });
    }

    try {
      const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: buildPrompt(payload.input),
          parameters: { max_new_tokens: 180, temperature: 0.7 },
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const reply =
        typeof data === "string"
          ? data
          : Array.isArray(data)
          ? data[0]?.generated_text || JSON.stringify(data)
          : data.generated_text || data.text || JSON.stringify(data);

      return jsonResponse(res, 200, { reply: String(reply).trim() });
    } catch (error) {
      return jsonResponse(res, 500, {
        error: `Model request failed: ${error.message}`,
      });
    }
  }

  jsonResponse(res, 404, { error: "Not found" });
}).listen(PORT, () => {
  console.log(`Chat backend listening on http://localhost:${PORT}`);
});
