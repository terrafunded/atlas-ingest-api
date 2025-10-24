// =======================================================
// 🌎 ATLAS INGEST API (Backend principal del pipeline)
// =======================================================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import puppeteer from "puppeteer"; // Puppeteer con instalación automática

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
const LOVABLE_INGEST_KEY = process.env.LOVABLE_INGEST_KEY || "FALUEFAPIEMASTER";

// =======================================================
// 🧩 FUNCIÓN AUXILIAR — LLAMAR FUNCIONES EN LOVABLE
// =======================================================
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
// 🧭 NUEVO — RENDER-PAGE (instala Chromium dinámicamente)
// =======================================================
app.get("/render-page", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });
  console.log("🌐 Renderizando página con instalación dinámica:", url);

  let browser;
  try {
    // Forzar instalación automática de Chromium si no existe
    const browserFetcher = puppeteer.createBrowserFetcher();
    const revisionInfo = await browserFetcher.download("1270643388");
    console.log("✅ Chromium descargado en:", revisionInfo.executablePath);

    browser = await puppeteer.launch({
      headless: "new",
      executablePath: revisionInfo.executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForTimeout(3000);
    const html = await page.content();

    console.log("✅ Renderizado con éxito:", html.length, "bytes");
    res.json({
      status: "ok",
      url,
      html_length: html.length,
      html: html.substring(0, 5000),
    });
  } catch (err) {
    console.error("❌ Error renderizando:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// =======================================================
// 🩵 HEALTH CHECK
// =======================================================
app.get("/", (_req, res) => res.send("Atlas Ingest API ✅ Running"));
app.listen(PORT, () =>
  console.log(`🚀 Atlas Ingest API corriendo en puerto ${PORT}`)
);
