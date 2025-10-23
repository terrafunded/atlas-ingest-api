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
  additionalProperties: false
};
const validateParse = ajv.compile(parseSchema);

async function callParserAgent({ source, url, html }) {
  const systemPrompt = `
You are ParserAgent for Atlas. Extract key land-listing fields from raw HTML and produce STRICT JSON:
{
  "source": "string",
  "url": "string",
  "name": "string|null",
  "price": "number|null",
  "currency": "USD",
  "acres": "number|null",
  "county": "string|null",
  "state": "string|null",
  "description": "string|null",
  "images": "string[]|null",
  "attributes": "object|null",
  "parse_confidence": "number"
}
Rules:
- price numeric only.
- acres numeric; if other units, note in attributes.unit.
- Respond ONLY JSON.
`;

  const userPrompt = `SOURCE: ${source}\nURL: ${url}\nHTML:\n${html?.slice(0,150000) ?? ""}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0
    })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

app.post("/parse", async (req, res) => {
  try {
    const body = req.body;
    if (!validateParse(body)) {
      return res.status(400).json({ error: "Invalid body", details: validateParse.errors });
    }
    let { source, url, html, html_id } = body;
    if (!html && html_id) {
      const r = await lovablePost("/get-scraped-html", { id: html_id });
      html = r?.html;
      if (!url && r?.url) url = r.url;
      if (!source && r?.source) source = r.source;
      if (!html) throw new Error("No HTML found for provided html_id");
    }
    if (!html) return res.status(400).json({ error: "Provide html or html_id" });

    const parsed = await callParserAgent({ source, url, html });
    const inserted = await lovablePost("/insert-listing-normalized", parsed);
    return res.json({ status: "ok", parsed, inserted });
  } catch (err) {
    console.error("Error in /parse:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// ====== NUEVO: /process-pipeline (automatización) ======
app.post("/process-pipeline", async (_req, res) => {
  try {
    const summary = {
      pending_normalize: 0,
      normalized_processed: 0,
      enriched_processed: 0
    };

    // 1) Pedir a Lovable los pendientes de normalización
    const pending = await lovablePost("/get-not-normalized", { limit: 20 });
    const listToNormalize = Array.isArray(pending?.data) ? pending.data : [];
    summary.pending_normalize = listToNormalize.length;

    // 2) Invocar NormalizerAgent para cada uno
    for (const rec of listToNormalize) {
      // rec: { id, price, acres, county, state, ... }
      await invokeAgent(AGENTKIT_NORMALIZER_ID, rec);
      summary.normalized_processed++;
    }

    // 3) Pedir a Lovable los recién normalizados sin Land Score
    const ready = await lovablePost("/get-recent-normalized", { hours: 24, limit: 20 });
    const listToEnrich = Array.isArray(ready?.data) ? ready.data : [];

    // 4) Invocar LandScoreAgent (si ya tienes ID)
    if (AGENTKIT_LANDSCORE_ID) {
      for (const rec of listToEnrich) {
        // rec: { id (listing_id), price_per_acre, acres, county, state, attributes }
        const payload = {
          listing_id: rec.id,
          price_per_acre: rec.price_per_acre,
          acres: rec.acres,
          county: rec.county,
          state: rec.state,
          attributes: rec.attributes || null
        };
        await invokeAgent(AGENTKIT_LANDSCORE_ID, payload);
        summary.enriched_processed++;
      }
    }

    return res.json({ status: "ok", summary });
  } catch (err) {
    console.error("Error in /process-pipeline:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// Healthchecks
app.get("/", (_req, res) => res.send("atlas-ingest-api running ✅"));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
