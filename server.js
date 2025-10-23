import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // si Render usa Node 18+ puedes eliminar esta línea, fetch ya existe globalmente

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Endpoint HTTP que Lovable/Supabase te dio
const LOVABLE_ENDPOINT = "https://rwyobvwzulgmkwzomuog.supabase.co/functions/v1/ingest-listing";

// ✅ Endpoint principal que usará tu agente o tu curl
app.post("/ingest-listing", async (req, res) => {
  const { source, url, html } = req.body;

  // Validar campos obligatorios
  if (!source || !url || !html) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // 🔄 Enviar los datos a Lovable vía HTTPS
    const response = await fetch(LOVABLE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source, url, html }),
    });

    // Leer respuesta de Lovable
    const result = await response.json();

    // ✅ Devolver el resultado al cliente que llamó a Render
    return res.status(response.status).json(result);
  } catch (error) {
    console.error("❌ Error al reenviar a Lovable:", error.message);
    return res.status(500).json({ error: "Failed to reach Lovable endpoint" });
  }
});

// ✅ Ruta de prueba (opcional)
app.get("/", (req, res) => {
  res.send("✅ Atlas Ingest Forwarder is running on Render");
});

// 🚀 Puerto de escucha (Render asigna automáticamente uno)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Forwarder running on port ${PORT}`);
});
