import express from "express";
import fetch from "node-fetch";
import Ajv from "ajv";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 10000;

// =======================================================
// 🔗 CONFIGURACIÓN GLOBAL
// =======================================================
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// IDs de agentes (debes configurarlos en Render Environment)
const AGENTKIT_NORMALIZER_ID = process.env.AGENTKIT_NORMALIZER_ID || "";
const AGENTKIT_LANDSCORE_ID = process.env.AGENTKIT_LANDSCORE_ID || "";
const AGENTKIT_SCRAPER_DIRECTOR_ID = process.env.AGENTKIT_SCRAPER_DIRECTOR_ID || "";
const AGENTKIT_RANCH_AGENT_ID = process.env.AGENTKIT_RANCH_AGENT_ID || "";
const AGENTKIT_LANDWATCH_AGENT_ID = process.env.AGENTKIT_LANDWATCH_AGENT_ID || "";

// URL base de Lovable (Functions)
const LOVABLE_BASE_URL = "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1";

// =======================================================
// 🧩 FUNCIONES AUXILIARES
// =======================================================

async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Lovable ${path} error ${res.status}: ${txt}`);
  }
  return res.json();
}

async function invokeAgent(workflowId, payload) {
  if (!workflowId) throw new Error("Agent workflow ID missing");
  const res = await fetch(`https://api.openai.com/v1/agents/${workflowId}/invoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
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

// =======================================================
// 🟩 ENDPOINT: /ingest-listing (usa webhook Lovable)
// =======================================================
app.post("/ingest-listing", async (req, res) => {
  try {
    const { source, url, html } = req.body || {};
    if (!source || !url || !html) {
      return res.status(400).json({ error: "Missing required fields (source, url, html)" });
    }

    const webhookUrl = `${LOVABLE_BASE_URL}/scraper-webhook`;
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, url, html })
    });
    const result = await r.json();
    return res.json({ status: "success", result });
  } catch (err) {
    console.error("Error /ingest-listing:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🟨 ENDPOINT: /parse  (ParserAgent para procesar HTML)
// =======================================================
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
      if (!html) throw new Error("No HTML found for html_id");
    }

    const systemPrompt = `
You are ParserAgent for Atlas. Extract key land-listing fields from raw HTML and return STRICT JSON.
`;
    const resOpenAI = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: html.slice(0, 150000) }
        ],
        temperature: 0
      })
    });
    const data = await resOpenAI.json();
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);

    const inserted = await lovablePost("/insert-listing-normalized", parsed);
    return res.json({ status: "ok", parsed, inserted });
  } catch (err) {
    console.error("Error /parse:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🟧 ENDPOINT: /process-pipeline (Normaliza + Enrich)
// =======================================================
app.post("/process-pipeline", async (_req, res) => {
  try {
    const summary = { normalized: 0, enriched: 0 };
    const pending = await lovablePost("/get-not-normalized", { limit: 20 });
    const listToNormalize = Array.isArray(pending?.data) ? pending.data : [];

    for (const rec of listToNormalize) {
      await invokeAgent(AGENTKIT_NORMALIZER_ID, rec);
      summary.normalized++;
    }

    const ready = await lovablePost("/get-recent-normalized", { hours: 24, limit: 20 });
    const listToEnrich = Array.isArray(ready?.data) ? ready.data : [];

    if (AGENTKIT_LANDSCORE_ID) {
      for (const rec of listToEnrich) {
        await invokeAgent(AGENTKIT_LANDSCORE_ID, {
          listing_id: rec.id,
          price_per_acre: rec.price_per_acre,
          acres: rec.acres,
          county: rec.county,
          state: rec.state
        });
        summary.enriched++;
      }
    }

    return res.json({ status: "ok", summary });
  } catch (err) {
    console.error("Error /process-pipeline:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🟦 ENDPOINT: /run-scraper-director (Nuevo)
// =======================================================
app.post("/run-scraper-director", async (req, res) => {
  try {
    const directorId = AGENTKIT_SCRAPER_DIRECTOR_ID;
    const ranchId = AGENTKIT_RANCH_AGENT_ID;
    const landwatchId = AGENTKIT_LANDWATCH_AGENT_ID;

    console.log("🔄 Invocando Director...");
    const directorRes = await fetch(`https://api.openai.com/v1/agents/${directorId}/invoke`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sources: ["ranchrealestate", "landwatch"], rules: { max_items: 10 } })
    });
    const directorData = await directorRes.json();
    const exclusion = directorData?.result?.summary?.urls || [];

    const payload = { exclusion_urls: exclusion, max_items: 10 };

    console.log("🏇 Ejecutando RanchRealEstateScraper...");
    const ranchRes = await fetch(`https://api.openai.com/v1/agents/${ranchId}/invoke`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        seed_urls: ["https://ranchrealestate.com/for-sale/"]
      })
    });
    const ranchData = await ranchRes.json();

    console.log("🌎 Ejecutando LandWatchScraper...");
    const landRes = await fetch(`https://api.openai.com/v1/agents/${landwatchId}/invoke`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        query_url: "https://www.landwatch.com/Texas_land_for_sale"
      })
    });
    const landData = await landRes.json();

    const summary = { ranchrealestate: ranchData, landwatch: landData };
    console.log("✅ Scrapers completados:", summary);

    return res.json({ status: "ok", summary });
  } catch (err) {
    console.error("❌ Error en /run-scraper-director:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// ❤️ HEALTHCHECKS
// =======================================================
app.get("/", (_req, res) => res.send("Atlas Scraper API running ✅"));
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, timestamp: new Date().toISOString() })
);

// =======================================================
// 🚀 START SERVER
// =======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
