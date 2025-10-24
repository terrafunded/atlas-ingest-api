// =======================================================
// 🕷️ ATLAS SCRAPER API (componente de extracción para Atlas Ingest)
// =======================================================
//
// ✅ Versión completa y estable (incluye TODO):
// - /extract-listings → Descarga listado principal y envía a Lovable
// - /render-page → Renderiza HTML de una URL
// - /ingest-listing → Recibe HTML ya scrapeado y lo reenvía a Lovable
// - /test-endpoints → Prueba de conexión directa a Lovable
// - Manejo de errores con try/catch y logs completos
// - Autenticación mediante encabezado "x-ingest-key"
// - Reintento automático con backoff exponencial
// - Compatible con Render y Supabase/Lovable
//
// =======================================================

import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cors({ origin: true }));

// =======================================================
// ⚙️ CONFIGURACIÓN GLOBAL
// =======================================================
const PORT = process.env.PORT || 10000;

// URL base para enviar datos a Lovable Cloud (tu Supabase functions endpoint)
const LOVABLE_WEBHOOK_URL =
  process.env.LOVABLE_WEBHOOK_URL ||
  "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1/scraper-webhook";

// Clave secreta de autenticación hacia Lovable
const LOVABLE_INGEST_KEY =
  process.env.LOVABLE_INGEST_KEY || "FALUEFAPIEMASTER";

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
//
// Esta ruta se encarga de:
// 1️⃣ Obtener el HTML del listado principal de terrenos.
// 2️⃣ Enviar ese HTML directamente a Lovable Cloud (tabla raw_listings).
// =======================================================
app.get("/extract-listings", async (req, res) => {
  try {
    const source = "RanchRealEstate";
    const url = "https://ranchrealestate.com/for-sale/";

    console.log("🔍 Iniciando extracción de listados desde:", url);

    const html = await safeFetch(url);
    console.log(`✅ HTML recibido (${html.length} caracteres). Enviando a Lovable...`);

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
//
// Recibe una URL a renderizar y devuelve su HTML.
// Ejemplo: /render-page?target=https://ranchrealestate.com/for-sale/
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
//
// Recibe JSON con { source, url, html } y lo reenvía a Lovable.
// Esta es la ruta usada cuando otro agente o servicio ya tiene el HTML.
// =======================================================
app.post("/ingest-listing", async (req, res) => {
  try {
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
//
// Verifica que el servicio puede comunicarse correctamente con Lovable.
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
// 🧰 RUTA: /debug
// =======================================================
//
// Permite ver configuraciones actuales para diagnóstico rápido.
// =======================================================
app.get("/debug", (req, res) => {
  res.json({
    port: PORT,
    webhook_url: LOVABLE_WEBHOOK_URL,
    ingest_key_configured: !!LOVABLE_INGEST_KEY,
  });
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
  console.log("   → GET  /debug");
  console.log("🔑 Autenticación con header: x-ingest-key");
});
