export const config = { maxDuration: 120 };

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.VERTEX_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured on server' }); return; }

  const { model, body, useGlobal } = req.body;
  if (!model || !body) { res.status(400).json({ error: 'Missing required fields: model, body' }); return; }

  const baseUrl = 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models';
  const url = `${baseUrl}/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (err: any) {
    console.error('Proxy error:', err);
    res.status(502).json({ error: 'Proxy request failed: ' + (err?.message || 'unknown') });
  }
}
