import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import Ajv from "ajv";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 10000;

// =======================================================
// 🔗 CONFIGURACIÓN GLOBAL
// =======================================================
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const LOVABLE_BASE_URL = "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1";

// IDs y assistants
const ASSISTANT_NORMALIZER_ID = process.env.ASSISTANT_NORMALIZER_ID; // asst_JlXMVNRYXAWrloJzdIVXGT7c
const AGENTKIT_LANDSCORE_ID = process.env.AGENTKIT_LANDSCORE_ID;
const AGENTKIT_SCRAPER_DIRECTOR_ID = process.env.AGENTKIT_SCRAPER_DIRECTOR_ID;
const AGENTKIT_RANCH_AGENT_ID = process.env.AGENTKIT_RANCH_AGENT_ID;
const AGENTKIT_LANDWATCH_AGENT_ID = process.env.AGENTKIT_LANDWATCH_AGENT_ID;

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

// =======================================================
// 🤖 INVOCAR ASSISTANT NORMALIZER (Assistants API)
// =======================================================
async function invokeNormalizerAssistant(payload) {
  try {
    // Crear thread
    const threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({})
    });

    const thread = await threadRes.json();
    if (!thread.id) {
      const txt = await threadRes.text();
      throw new Error(`No se pudo crear el thread. Respuesta: ${txt}`);
    }

    // Enviar mensaje al Assistant
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({
        role: "user",
        content: [{ type: "text", text: JSON.stringify(payload) }]
      })
    });

    // Ejecutar Assistant
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2"
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_NORMALIZER_ID })
    });

    const runData = await runRes.json();
    return runData;
  } catch (err) {
    console.error("Error invokeNormalizerAssistant:", err);
    return { status: "error", message: err.message };
  }
}

// =======================================================
// 🟩 ENDPOINT: /ingest-listing (recibe datos de scraping)
// =======================================================
app.post("/ingest-listing", async (req, res) => {
  try {
    const { source, url, html } = req.body || {};
    if (!source || !url || !html) {
      return res.status(400).json({ error: "Missing required fields" });
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
// 🟨 ENDPOINT: /process-pipeline (normalización completa)
// =======================================================
app.post("/process-pipeline", async (_req, res) => {
  try {
    console.log("🚀 Ejecutando pipeline de normalización...");

    const pending = await lovablePost("/get-not-normalized", { limit: 10 });
    const listToNormalize = Array.isArray(pending?.data) ? pending.data : [];

    let normalizedCount = 0;

    for (const rec of listToNormalize) {
      console.log("📦 Enviando registro:", rec);
      const result = await invokeNormalizerAssistant(rec);
      console.log("Resultado Normalizer:", result);
      normalizedCount++;
    }

    console.log("✅ Normalización completada.");
    return res.json({
      status: "ok",
      summary: { normalized: normalizedCount }
    });
  } catch (err) {
    console.error("Error /process-pipeline:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// ❤️ HEALTH CHECKS
// =======================================================
app.get("/", (_req, res) => res.send("Atlas API ✅ NormalizerAssistant activo"));
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, timestamp: new Date().toISOString() })
);

// =======================================================
// 🚀 START SERVER
// =======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
