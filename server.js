import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Configurar conexión a la base de datos Supabase (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Endpoint principal
app.post("/ingest-listing", async (req, res) => {
  const { source, url, html } = req.body;

  if (!source || !url || !html) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
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
    return res.json({ status: "success", message: "Inserted into scraped_html" });
  } catch (error) {
    console.error("❌ DB insert error:", error.message);
    return res.status(500).json({ error: error.mess
