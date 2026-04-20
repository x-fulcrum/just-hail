import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { messages, max_tokens = 16000, stream = false } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(200);

      const anthropicStream = client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens,
        messages,
      });

      anthropicStream.on('text', (delta) => {
        res.write(delta);
      });

      await anthropicStream.finalMessage();
      return res.end();
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return res.status(200).json({ text });
  } catch (err) {
    console.error('Claude proxy error:', err);
    if (res.headersSent) {
      try { res.end(); } catch {}
      return;
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(err.status || 500).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
