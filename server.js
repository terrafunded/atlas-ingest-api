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
const LOVABLE_INGEST_KEY =
  process.env.LOVABLE_INGEST_KEY || "INGEST_SECRET_KEY";

// =======================================================
// 🔁 FUNCIÓN DE REINTENTO AUTOMÁTICO CON BACKOFF
// =======================================================
async function safeFetch(url, options = {}, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, options);
      const text = await resp.text();
      try {
        return JSON.parse(text);
      } catch {
        console.warn(`⚠️ Respuesta no JSON válida en intento ${i + 1}:`, text.slice(0, 150));
        return { warning: "Respuesta no válida", raw: text };
      }
    } catch (err) {
      console.error(`❌ Error en fetch (intento ${i + 1}):`, err.message);
      if (i < retries - 1) {
        const wait = delay * Math.pow(2, i);
        console.log(`⏳ Reintentando en ${wait} ms...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — LLAMAR FUNCIONES EN LOVABLE
// =======================================================
async function lovablePost(path, body) {
  try {
    const res = await fetch(`${LOVABLE_BASE_URL}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_INGEST_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      console.error("❌ Error parseando respuesta de Lovable:", err);
      return { error: "Respuesta no válida de Lovable", raw: text };
    }
  } catch (err) {
    console.error("❌ Error llamando a Lovable:", err);
    return { error: err.message };
  }
}

// =======================================================
// 🔧 ENDPOINT DE PRUEBA
// =======================================================
app.get("/", (req, res) => {
  res.send("✅ Atlas Ingest API funcionando correctamente con try/catch y retries.");
});

// =======================================================
// 🧠 ENDPOINT PRINCIPAL DEL PIPELINE
// =======================================================
app.post("/process-pipeline", async (req, res) => {
  try {
    const { client, thread, run, current } = req.body;
    const outputs = [];

    if (current?.required_action?.type === "submit_tool_outputs") {
      for (const toolCall of current.required_action.submit_tool_outputs.tool_calls) {
        const fn = toolCall.function.name;

        // ===================================================
        // 🕷️ EXTRACT LISTINGS
        // ===================================================
        if (fn === "extract_listings") {
          try {
            const data = await safeFetch("https://atlas-scraper-1.onrender.com/extract-listings");
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(data),
            });
          } catch (err) {
            console.error("❌ Error ejecutando extract_listings:", err);
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: err.message }),
            });
          }
        }

        // ===================================================
        // 🧭 RENDER PAGE
        // ===================================================
        else if (fn === "render_page") {
          try {
            const data = await safeFetch("https://atlas-scraper-1.onrender.com/render-page");
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(data),
            });
          } catch (err) {
            console.error("❌ Error ejecutando render_page:", err);
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: err.message }),
            });
          }
        }

        // ===================================================
        // 📥 INGEST LISTING
        // ===================================================
        else if (fn === "ingest_listing") {
          try {
            const data = await safeFetch(
              "https://atlas-scraper-1.onrender.com/ingest-listing",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.body || {}),
              }
            );
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(data),
            });
          } catch (err) {
            console.error("❌ Error ejecutando ingest_listing:", err);
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: err.message }),
            });
          }
        }

        // ===================================================
        // 🧮 NORMALIZE LISTINGS (Lovable)
        // ===================================================
        else if (fn === "normalize_listings") {
          try {
            const data = await lovablePost("normalize-listings", { thread_id: thread.id });
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(data),
            });
          } catch (err) {
            console.error("❌ Error ejecutando normalize_listings:", err);
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: err.message }),
            });
          }
        }

        // ===================================================
        // ⚠️ DESCONOCIDO
        // ===================================================
        else {
          console.warn("⚠️ Función desconocida:", fn);
          outputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ warning: `Función desconocida: ${fn}` }),
          });
        }
      }

      // ===================================================
      // 📤 ENVÍO FINAL AL CLIENTE
      // ===================================================
      try {
        await client.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
          tool_outputs: outputs,
        });
      } catch (err) {
        console.error("❌ Error enviando resultados a cliente:", err);
      }
    }

    res.json({
      status: "ok",
      summary: { tool_outputs: outputs.length },
    });
  } catch (err) {
    console.error("❌ Error general en /process-pipeline:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🧱 ENDPOINTS SECUNDARIOS (Passthroughs a Render Scraper)
// =======================================================
app.get("/extract-listings", async (req, res) => {
  try {
    const data = await safeFetch("https://atlas-scraper-1.onrender.com/extract-listings");
    res.json(data);
  } catch (err) {
    console.error("❌ Error en /extract-listings:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/render-page", async (req, res) => {
  try {
    const data = await safeFetch("https://atlas-scraper-1.onrender.com/render-page");
    res.json(data);
  } catch (err) {
    console.error("❌ Error en /render-page:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/ingest-listing", async (req, res) => {
  try {
    const data = await safeFetch("https://atlas-scraper-1.onrender.com/ingest-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    res.json(data);
  } catch (err) {
    console.error("❌ Error en /ingest-listing:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🚀 SERVIDOR EN EJECUCIÓN
// =======================================================
app.listen(PORT, () => {
  console.log(`✅ Atlas Ingest API corriendo en puerto ${PORT} con manejo de errores y retries.`);
});
