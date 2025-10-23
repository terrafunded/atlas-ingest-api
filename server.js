import express from "express";
import fetch from "node-fetch";
import Ajv from "ajv";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "6mb" }));
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 10000;

// ====== Variables de entorno necesarias ======
const LOVABLE_BASE_URL = "https://db.rwyobvwzulgmkwzomuog.supabase.co/functions/v1";
const LOVABLE_KEY = process.env.LOVABLE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// IDs de agentes (AgentKit Workflows)
// NormalizerAgent (ya lo tienes):
const AGENTKIT_NORMALIZER_ID = process.env.AGENTKIT_NORMALIZER_ID || "wf_68f98f58a8a08190989d84f34b92f954080869da47c33304";
// LandScoreAgent (cuando lo crees, pon su ID aquí):
const AGENTKIT_LANDSCORE_ID = process.env.AGENTKIT_LANDSCORE_ID || "";

// ====== Helpers ======
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_KEY}`
    },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Lovable ${path} error ${res.status}: ${txt}`);
  }
  return res.json();
}

async function invokeAgent(workflowId, payload) {
  if (!workflowId) throw new Error("Agent workflow ID missing.");
  const url = `https://api.openai.com/v1/agents/${workflowId}/invoke`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent ${workflowId} error ${res.status}: ${txt}`);
  }
  return res.json();
}

// ====== Endpoint original: /ingest-listing ======
app.post("/ingest-listing", async (req, res) => {
  try {
    const { source, url, html } = req.body || {};
    if (!source || !url || !html) {
      return res.status(400).json({ error: "Missing required fields (source, url, html)" });
    }
    const inserted = await lovablePost("/ingest-listing", { source, url, html });
    return res.json({ status: "success", inserted });
  } catch (err) {
    console.error("Error in /ingest-listing:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// ====== /parse para convertir HTML en listing normalizado ======
const ajv = new Ajv();
const parseSchema = {
  type: "object",
  required: ["source", "url"],
  properties: {
    source: { type: "string" },
    url: { type: "string" },
    html: { type: "string", nullable: true },
    html_id: { type: "string", nullable: true }
  },
  additionalPropert
