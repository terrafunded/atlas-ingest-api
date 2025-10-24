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
const LOVABLE_BASE_URL = process.env.LOVABLE_BASE_URL || "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1";
const ASSISTANT_NORMALIZER_ID = process.env.ASSISTANT_NORMALIZER_ID;
// 🔐 NUEVO: Service Role Key para autenticar el webhook de Lovable
const LOVABLE_SERVICE_KEY = process.env.LOVABLE_SERVICE_KEY;

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — LLAMAR FUNCIONES EN LOVABLE
// =======================================================
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Si tus otras funciones de Lovable también requieren auth, descomenta esta línea:
      // "Authorization": `Bearer ${LOVABLE_SERVICE_KEY}`
    },
    body: JSON.stringify(body || {})
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
    // 1️⃣ Crear thread
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
    if (!thread.id) throw new Error(`No se pudo crear el thread: ${JSON.stringify(thread)}`);

    // 2️⃣ Enviar mensaje
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

    // 3️⃣ Ejecutar Assistant
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
      return res.status(400).json({ error: "Campos requeridos: source, url, html" });
    }

    // 🔐 IMPORTANTE: Autorización con Service Role Key al webhook
    const webhookUrl = `${LOVABLE_BASE_URL}/scraper-webhook`;
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_SERVICE_KEY}`
      },
      body: JSON.stringify({ source, url, html })
    });

    // Si el webhook requiere respuesta JSON, la parseamos:
    let result;
    const contentType = r.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      result = await r.json();
    } else {
      result = { status: r.ok ? "success" : "error", httpStatus: r.status };
    }

    console.log("✅ Ingesta enviada a Lovable:", url, "→", result);
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
      await new Promise(r => setTimeout(r, 800)); // ligera pausa para evitar picos
    }

    console.log("✅ Normalización completada.");
    return res.json({
      status: "ok",
      summary: { normalized: normalizedCount }
    });
  } catch (err) {
    console.error("❌ Error /process-pipeline:", err);
    return res.status(500).json({ error: err.message });
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
