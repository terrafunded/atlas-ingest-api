import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // Render usa Node 18+, fetch ya está disponible, pero lo incluimos por compatibilidad

const app = express();
app.use(cors());
app.use(express.json());

// ✅ URL del endpoint de Lovable (cámbiala cuando te la den)
const LOVABLE_ENDPOINT = "https://lovable.yourproject.dev/api/ingest-listing";

// ✅ Endpoint principal que Render sigue usando
app.post("/ingest-listing", async (req, res) => {
  const { source, url, html } = req.body;

  if (!source || !url || !html) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // 🔄 Reenviar el JSON al endpoint de Lovable
    const response = await fetch(LOVABLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, url, html }),
    });

    // 🔍 Leer respuesta del servidor Lovable
    const result = await response.json();

    // ✅ Devolver el resultado a quien llamó a Render
    return res.status(response.status).json(result);
  } catch (error) {
    console.error("❌ Error sending data to Lovable:", error.message);
    return res.status(500).json({ error: "Failed to reach Lovable endpoint" });
  }
});

// 🚀 Puerto de escucha (Render asigna uno automáticamente)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Render forwarding server running on port ${PORT}`);
});
