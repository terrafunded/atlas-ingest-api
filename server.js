// =======================================================
// 🌎 ATLAS INGEST API (Backend principal del pipeline)
// =======================================================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: true }));

// =======================================================
// ⚙️ CONFIGURACIÓN GLOBAL
// =======================================================
const PORT = process.env.PORT || 10000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const LOVABLE_BASE_URL =
  process.env.LOVABLE_BASE_URL ||
  "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1";
const ASSISTANT_NORMALIZER_ID = process.env.ASSISTANT_NORMALIZER_ID;

// 🔐 Clave fija para la autenticación con Lovable
const LOVABLE_INGEST_KEY = process.env.LOVABLE_INGEST_KEY || "FALUEFAPIEMASTER";

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — LLAMAR FUNCIONES EN LOVABLE
// =======================================================
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lovable ${path} error ${res.status}: ${text}`);
  }
  return res.json();
}

// =======================================================
// 🧠 FUNCIÓN — LLAMAR AL ASSISTANT NORMALIZER
// =======================================================
async function invokeNormalizerAssistant(payload) {
  try {
    const threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({}),
    });
    const thread = await threadRes.json();
    if (!thread.id)
      throw new Error(`No se pudo crear el thread: ${JSON.stringify(thread)}`);

    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: [{ type: "text", text: JSON.stringify(payload) }],
      }),
    });

    const runRes = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({ assistant_id: ASSISTANT_NORMALIZER_ID }),
      }
    );

    const runData = await runRes.json();
    console.log("🧠 Respuesta Normalizer:", runData);
    return runData;
  } catch (err) {
    console.error("❌ Error invokeNormalizerAssistant:", err);
    return { status: "error", message: err.message };
  }
}

// =======================================================
// 🟩 ENDPOINT — INGEST LISTING (desde SCRAPER)
// =======================================================
app.post("/ingest-listing", async (req, res) => {
  try {
    const { source, url, html } = req.body || {};
    if (!source || !url || !html) {
      return res
        .status(400)
        .json({ error: "Campos requeridos: source, url, html" });
    }

    const webhookUrl =
      "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1/scraper-webhook";

    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ingest-key": LOVABLE_INGEST_KEY,
      },
      body: JSON.stringify({ source, url, html }),
    });

    const result = await r.json();
    console.log("✅ Ingesta enviada a Lovable:", url);
    return res.json({ status: "success", result });
  } catch (err) {
    console.error("❌ Error /ingest-listing:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🟨 ENDPOINT — PROCESS PIPELINE (NORMALIZACIÓN)
// =======================================================
app.post("/process-pipeline", async (_req, res) => {
  try {
    console.log("🚀 Ejecutando pipeline de normalización...");
    const pending = await lovablePost("/get-not-normalized", { limit: 10 });

    const listToNormalize = Array.isArray(pending?.data) ? pending.data : [];
    console.log(`📦 ${listToNormalize.length} registros pendientes.`);

    let normalizedCount = 0;

    for (const rec of listToNormalize) {
      console.log(`🧾 Normalizando: ${rec.url || rec.id}`);
      const result = await invokeNormalizerAssistant(rec);
      console.log("➡️ Resultado:", result);
      normalizedCount++;
      await new Promise((r) => setTimeout(r, 800));
    }

    console.log("✅ Normalización completada.");
    return res.json({
      status: "ok",
      summary: { normalized: normalizedCount },
    });
  } catch (err) {
    console.error("❌ Error /process-pipeline:", err);
    return res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🧭 PROXY PARA SCRAPING REAL (bypass Cloudflare y JS dinámico)
// =======================================================
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });

  try {
    const response = await fetch(url, {
      headers: {
        // Simula un navegador real para evitar bloqueos por Cloudflare
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://www.google.com/",
        Connection: "keep-alive",
      },
      redirect: "follow",
    });

    const html = await response.text();
    const status = response.status;

    // Enviamos una respuesta resumida para verificar longitud del HTML
    res.json({
      status: "ok",
      code: status,
      url,
      html_length: html.length,
      preview: html.substring(0, 5000), // Primeros 5k caracteres para debug
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
      url,
    });
  }
});

// =======================================================
// 🩵 HEALTH CHECK
// =======================================================
app.get("/", (_req, res) => res.send("Atlas Ingest API ✅ Running"));
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, timestamp: new Date().toISOString() })
);

// =======================================================
// 🚀 INICIAR SERVIDOR
// =======================================================
app.listen(PORT, () => {
  console.log(`🚀 Atlas Ingest API corriendo en puerto ${PORT}`);
});
