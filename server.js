// =======================================================
// 🌎 ATLAS INGEST API (Backend principal del pipeline)
// =======================================================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import puppeteer from "puppeteer";

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
// 🧭 PROXY — Bypass Cloudflare
// =======================================================
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const html = await response.text();
    res.json({
      status: "ok",
      html_length: html.length,
      html: html.substring(0, 5000),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// =======================================================
// 🧠 NUEVO — ENDPOINT RENDER-PAGE (usa Puppeteer moderno)
// =======================================================
app.get("/render-page", async (req, res) => {
  const url = req.query.url;
  if (!url)
    return res.status(400).json({ error: "Missing url parameter" });

  console.log("🌐 Renderizando página:", url);
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process",
        "--no-zygote",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Espera moderna

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
// 🧩 NUEVO — ENDPOINT EXTRACT-LISTINGS (usa Puppeteer)
// =======================================================
app.get("/extract-listings", async (req, res) => {
  const url = req.query.url || "https://ranchrealestate.com/for-sale/";
  console.log("🔍 Extrayendo listados de:", url);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const listings = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href*='/property/']"));
      return anchors.map((a) => a.href);
    });

    console.log(`✅ ${listings.length} listados encontrados`);
    res.json({ status: "ok", count: listings.length, listings });
  } catch (err) {
    console.error("❌ Error /extract-listings:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    if (browser) await browser.close();
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
app.listen(PORT, () =>
  console.log(`🚀 Atlas Ingest API corriendo en puerto ${PORT}`)
);
