import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /ingest-listing
app.post('/ingest-listing', async (req, res) => {
  const { source, url, html } = req.body;

  if (!source || !url || !html) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const { error } = await supabase.from('scraped_html').upsert({
    source,
    url,
    html,
    scraped_at: new Date().toISOString()
  });

  if (error) {
    console.error('Supabase insert error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  res.json({ status: 'success', message: 'Inserted into scraped_html' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Ingestion server running on port ${PORT}`);
});
