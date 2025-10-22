import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Configuración de conexión PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  host: "52.213.34.17", // ✅ dirección IPv4 directa de tu host Supabase
  port: 5432,
  family: 4 // ✅ fuerza IPv4 (Render intenta IPv6 por defecto)
});

// ✅ Endpoint principal: /ingest-listing
app.post("/ingest-listing", async (req, res) => {
  const { source, url, html } = req.body;

  // Validar campos obligatorios
  if (!source || !url || !html) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Inserta o actualiza el registro según la URL (única)
    const query = `
      INSERT INTO scraped_html (source, url, html, scraped_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (url)
      DO UPDATE SET
        source = EXCLUDED.source,
        html = EXCLUDED.html,
        scraped_at = NOW();
    `;

    await pool.query(query, [source, url, html]);
    console.log(`✅ Inserted/updated record for ${url}`);

    return res.json({
      status: "success",
      message: `Inserted into scraped_html: ${url}`
    });
  } catch (error) {
    console.error("❌ Database error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ✅ Ruta de prueba (opcional)
app.get("/", (req, res) => {
  res.send("✅ Atlas Ingest API is running");
});

// 🚀 Puerto de escucha (Render asigna automáticamente uno)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Ingestion server running on port ${PORT}`);
});
