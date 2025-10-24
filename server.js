import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 10000;

// =======================================================
// 🧠  Endpoint que usa la versión integrada de Chromium
// =======================================================
app.get("/render-page", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url parameter" });

  console.log("🌐 Renderizando:", url);
  let browser;
  try {
    // 🚀  Usa el binario de Chromium que Puppeteer ya trae empaquetado
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForTimeout(3000);

    const html = await page.content();
    console.log("✅ Renderizado:", html.length, "bytes");

    res.json({
      status: "ok",
      url,
      html_length: html.length,
      html: html.substring(0, 5000)
    });
  } catch (err) {
    console.error("❌ Error renderizando:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// =======================================================
app.get("/", (_req, res) => res.send("Atlas Ingest API ✅ Running"));
app.listen(PORT, () =>
  console.log(`🚀 Atlas Ingest API corriendo en puerto ${PORT}`)
);
