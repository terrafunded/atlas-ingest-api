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
const LOVABLE_INGEST_KEY = process.env.LOVABLE_INGEST_KEY || "INGEST_SECRET_KEY";

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — LLAMAR FUNCIONES EN LOVABLE
// =======================================================
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_INGEST_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// =======================================================
// 🧠 ENDPOINT PRINCIPAL DEL PIPELINE
// =======================================================
app.post("/process-pipeline", async (req, res) => {
  try {
    const { client, thread, run, current } = req.body;
    const outputs = [];

    if (current.required_action?.type === "submit_tool_outputs") {
      for (const toolCall of current.required_action.submit_tool_outputs.tool_calls) {
        const fn = toolCall.function.name;

        // ===================================================
        // 🕷️ EXTRACT LISTINGS
        // ===================================================
        if (fn === "extract_listings") {
          try {
            const resp = await fetch("https://atlas-scraper-1.onrender.com/extract-listings");
            const text = await resp.text();
            const data = JSON.parse(text);
            outputs.push({ tool_call_id: toolCall.id, output: JSON.stringify(data) });
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
            const resp = await fetch("https://atlas-scraper-1.onrender.com/render-page");
            const text = await resp.text();
            const data = JSON.parse(text);
            outputs.push({ tool_call_id: toolCall.id, output: JSON.stringify(data) });
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
            const resp = await fetch("https://atlas-scraper-1.onrender.com/ingest-listing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req.body || {}),
            });
            const text = await resp.text();
            const data = JSON.parse(text);
            outputs.push({ tool_call_id: toolCall.id, output: JSON.stringify(data) });
          } catch (err) {
            console.error("❌ Error ejecutando ingest_listing:", err);
            outputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: err.message }),
            });
          }
        }
      }

      // ===================================================
      // 📤 ENVÍO FINAL AL CLIENTE
      // ===================================================
      await client.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
        tool_outputs: outputs,
      });
    }

    res.json({ status: "ok", summary: { normalized: outputs.length } });
  } catch (err) {
    console.error("❌ Error general en /process-pipeline:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🚀 SERVIDOR EN EJECUCIÓN
// =======================================================
app.listen(PORT, () => {
  console.log(`✅ Atlas Ingest API corriendo en puerto ${PORT}`);
});
