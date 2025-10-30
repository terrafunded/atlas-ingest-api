// =======================================================
// 🕷️ ATLAS SCRAPER API (componente de extracción para Atlas Ingest)
// =======================================================
//
// ✅ Incluye:
// - GET  /extract-listings → Descarga HTML de listado principal y envía a Lovable
// - GET  /render-page → Renderiza HTML de una URL
// - POST /ingest-listing → Recibe {source,url,html} y lo envía a Lovable
// - GET  /test-endpoints → Prueba de conexión directa a Lovable
// - POST /reprocess-source → Reprocesa TODOS los raw_listings de una fuente
// - Autenticación mediante encabezado "x-ingest-key"
// - Reintento controlado
// - Integración con Supabase para leer raw_listings
//
// =======================================================

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cors({ origin: true }));

// =======================================================
// ⚙️ CONFIGURACIÓN GLOBAL
// =======================================================
const PORT = process.env.PORT || 10000;

// Webhook de Lovable (Supabase Edge Function)
const LOVABLE_WEBHOOK_URL =
  process.env.LOVABLE_WEBHOOK_URL ||
  "https://czgwwsdcxbsuodmvhlgm.supabase.co/functions/v1/scraper-webhook";

// Clave secreta para autenticación entre servicios
const LOVABLE_INGEST_KEY =
  process.env.LOVABLE_INGEST_KEY || "FALUEFAPIEMASTER";

// URL pública de este servicio (para auto-llamarse)
const RENDER_API_URL =
  process.env.RENDER_API_URL || "http://localhost:" + PORT;

// Supabase (para leer raw_listings y sources)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

// =======================================================
// 🧠 FUNCIÓN AUXILIAR — Espera (para throttling controlado)
// =======================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =======================================================
// 🔁 FUNCIÓN DE REINTENTO CON BACKOFF EXPONENCIAL
// =======================================================
async function safeFetch(url, options = {}, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, options);
      const text = await resp.text();
      return text;
    } catch (err) {
      console.error(`❌ Error fetch intento ${i + 1}:`, err.message);
      if (i < retries - 1) {
        const wait = delay * Math.pow(2, i);
        console.log(`⏳ Reintentando en ${wait} ms...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — ENVIAR A LOVABLE
// =======================================================
async function sendToLovable(payload) {
  try {
    console.log("📤 Enviando a Lovable...");
    const res = await fetch(LOVABLE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ingest-key": LOVABLE_INGEST_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("📨 Respuesta Lovable:", text.slice(0, 200));

    return {
      ok: res.ok,
      status: res.status,
      length: text.length,
      body: text,
    };
  } catch (err) {
    console.error("❌ Error enviando a Lovable:", err);
    return { error: err.message };
  }
}

// =======================================================
// 🧾 RUTA BASE — Diagnóstico
// =======================================================
app.get("/", (req, res) => {
  res.send("✅ Atlas Scraper API funcionando correctamente (versión completa).");
});

// =======================================================
// 🕸️ RUTA: /extract-listings
// =======================================================
app.get("/extract-listings", async (req, res) => {
  try {
    const source = "ranchrealestate"; // usa tu slug real
    const url = "https://ranchrealestate.com/for-sale/";

    console.log("🔍 Iniciando extracción de listados desde:", url);

    const html = await safeFetch(url);
    console.log(`✅ HTML recibido (${html.length} chars). Enviando a Lovable...`);

    const payload = { source, url, html };
    const lovableResponse = await sendToLovable(payload);

    res.json({
      ok: true,
      source,
      url,
      html_length: html.length,
      lovable_status: lovableResponse.status,
    });
  } catch (err) {
    console.error("❌ Error en /extract-listings:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🧭 RUTA: /render-page
// =======================================================
app.get("/render-page", async (req, res) => {
  try {
    const { target } = req.query;
    if (!target) {
      return res.status(400).json({ error: "Falta parámetro ?target=" });
    }

    console.log(`🧭 Renderizando página destino: ${target}`);
    const html = await safeFetch(target);
    console.log(`📄 Página renderizada (${html.length} chars)`);

    res.json({ ok: true, target, size: html.length });
  } catch (err) {
    console.error("❌ Error en /render-page:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 📥 RUTA: /ingest-listing
// =======================================================
app.post("/ingest-listing", async (req, res) => {
  try {
    const key = req.headers["x-ingest-key"];
    if (key !== LOVABLE_INGEST_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { source, url, html } = req.body;
    if (!source || !url || !html) {
      return res
        .status(400)
        .json({ error: "Faltan campos requeridos: source, url, html" });
    }

    console.log(`📩 Ingestando manualmente listing de ${source} (${url})`);
    const payload = { source, url, html };
    const lovableResponse = await sendToLovable(payload);

    console.log("✅ Envío completado a Lovable");

    res.json({
      ok: true,
      source,
      url,
      html_length: html.length,
      lovable_status: lovableResponse.status,
    });
  } catch (err) {
    console.error("❌ Error en /ingest-listing:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🧪 RUTA: /test-endpoints
// =======================================================
app.get("/test-endpoints", async (req, res) => {
  try {
    console.log("🧪 Probando conexión con Lovable...");
    const testPayload = {
      source: "TestSource",
      url: "https://example.com",
      html: "<html><body>Test OK</body></html>",
    };

    const result = await sendToLovable(testPayload);
    console.log("✅ Resultado prueba:", result);

    res.json({
      ok: true,
      message: "Conexión con Lovable funcional",
      lovable_status: result.status,
      response_length: result.length,
    });
  } catch (err) {
    console.error("❌ Error en /test-endpoints:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🔁 RUTA: /reprocess-source (versión con lookup por UUID)
// =======================================================
app.post("/reprocess-source", async (req, res) => {
  try {
    const key = req.headers["x-ingest-key"];
    if (key !== LOVABLE_INGEST_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (!supabase) {
      return res
        .status(500)
        .json({ error: "Supabase no configurado (faltan env vars)" });
    }

    const { source } = req.body;
    if (!source) {
      return res.status(400).json({ error: "El campo 'source' es requerido" });
    }

    console.log(`🔎 Buscando UUID para la fuente: ${source}`);

    // 1️⃣ Buscar el source_id real en la tabla sources
    const { data: sourceRecord, error: sourceError } = await supabase
      .from("sources")
      .select("id")
      .eq("name", source)
      .single();

    if (sourceError || !sourceRecord) {
      console.error("❌ Fuente no encontrada:", sourceError?.message);
      return res.status(404).json({ error: "Fuente no encontrada en tabla sources" });
    }

    const sourceId = sourceRecord.id;
    console.log(`✅ Fuente encontrada, ID: ${sourceId}`);

    // 2️⃣ Buscar listings asociados a ese source_id
    const { data: listings, error } = await supabase
      .from("raw_listings")
      .select("id, url, html")
      .eq("source_id", sourceId);

    if (error) throw error;

    if (!listings || listings.length === 0) {
      return res.status(404).json({
        ok: false,
        message: `No se encontraron listings para la fuente ${source}`,
      });
    }

    console.log(`📦 ${listings.length} listings encontrados. Iniciando reprocess...`);

    // 3️⃣ Reinyectar cada listing a /ingest-listing interno
    let processed = 0;
    for (const listing of listings) {
      const payload = {
        source,
        url: listing.url,
        html: listing.html || "<html></html>",
      };

      await fetch(`${RENDER_API_URL}/ingest-listing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingest-key": LOVABLE_INGEST_KEY,
        },
        body: JSON.stringify(payload),
      });

      processed++;
    }

    console.log(`✅ Reprocesados ${processed} listings de ${source}`);
    res.json({
      ok: true,
      message: `Reprocessed ${processed} listings from ${source}`,
      listings_count: processed,
    });
  } catch (err) {
    console.error("❌ Error en /reprocess-source:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 🚀 SERVIDOR EN EJECUCIÓN
// =======================================================
app.listen(PORT, () => {
  console.log(`✅ Atlas Scraper API corriendo en puerto ${PORT}`);
  console.log("🌐 Rutas activas:");
  console.log("   → GET  /");
  console.log("   → GET  /extract-listings");
  console.log("   → GET  /render-page?target=<url>");
  console.log("   → POST /ingest-listing");
  console.log("   → GET  /test-endpoints");
  console.log("   → POST /reprocess-source  ← NUEVA");
  console.log("🔑 Autenticación con header: x-ingest-key");
});
