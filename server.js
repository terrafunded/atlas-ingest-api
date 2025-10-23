import express from "express";
import fetch from "node-fetch";
import Ajv from "ajv";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cors({ origin: true }));

const PORT = process.env.PORT || 10000;

// 🔗 Variables específicas de tu entorno actual
const LOVABLE_BASE_URL = "https://db.rwyobvwzulgmkwzomuog.supabase.co/functions/v1";
const LOVABLE_KEY = process.env.LOVABLE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ----------------------------------------------------------------
// 🔸 Helper para hacer POST a Lovable
async function lovablePost(path, body) {
  const res = await fetch(`${LOVABLE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Lovable ${path} error ${res.status}: ${txt}`);
  }
  return res.json();
}

// 🔸 Llamada al agente de OpenAI
async function callParserAgent({ source, url, html }) {
  const systemPrompt = `
You are ParserAgent for Atlas. Extract key land-listing fields from raw HTML and produce STRICT JSON:
{
  "source": "string",
  "url": "string",
  "name": "string|null",
  "price": "number|null",
  "currency": "USD",
  "acres": "number|null",
  "county": "string|null",
  "state": "string|null",
  "description": "string|null",
  "images": "string[]|null",
  "attributes": "object|null",
  "parse_confidence": "number"
}
Rules:
- price numeric only.
- acres numeric; if other units, note in attributes.unit.
- Respond ONLY JSON.
`;

  const userPrompt = `SOURCE: ${source}\nURL: ${url}\nHTML:\n${html?.slice(0, 150000) ?? ""}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(text);
}

// ----------------------------------------------------------------
// 🔸 Validación del body con AJV
const ajv = new Ajv();
const schema = {
  type: "object",
  required: ["source", "url"],
  properties: {
    source: { type: "string" },
    url: { type: "string" },
    html: { type: "string", nullable: true },
    html_id: { type: "string", nullable: true },
  },
  additionalProperties: false,
};
const validate = ajv.compile(schema);

// ----------------------------------------------------------------
// 🚀 NUEVO ENDPOINT /parse
app.post("/parse", async (req, res) => {
  try {
    const body = req.body;
    if (!validate(body)) {
      return res.status(400).json({ error: "Invalid body", details: validate.errors });
    }

    let { source, url, html, html_id } = body;

    // Si no viene el HTML, lo obtenemos desde Lovable
    if (!html && html_id) {
      const r = await lovablePost("/get-scraped-html", { id: html_id });
      html = r?.html;
      if (!url && r?.url) url = r.url;
      if (!source && r?.source) source = r.source;
      if (!html) throw new Error("No HTML found for provided html_id");
    }

    if (!html) {
      return res.status(400).json({ error: "Provide html or html_id" });
    }

    // 1️⃣ Parse con OpenAI
    const parsed = await callParserAgent({ source, url, html });

    // 2️⃣ Inserta el resultado en listings_normalized
    const inserted = await lovablePost("/insert-listing-normalized", parsed);

    return res.json({ status: "ok", parsed, inserted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// ----------------------------------------------------------------
// 🩺 Healthcheck
app.get("/", (_req, res) => res.send("atlas-ingest-api running ✅"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
