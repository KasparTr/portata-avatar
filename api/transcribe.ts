import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Serverless function to proxy ElevenLabs speech-to-text requests
 * This keeps the API key secure on the server side
 *
 * Note: Vercel serverless functions automatically parse FormData from multipart/form-data requests
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Get the raw body to forward as-is to ElevenLabs
    // Vercel provides the raw body buffer for multipart/form-data
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    }

    // Forward the request body directly to ElevenLabs
    const response = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': contentType,
        },
        // @ts-ignore - req body can be buffer
        body: req.body
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Return the transcription result
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error in transcription proxy:', error);
    return res.status(500).json({
      error: 'Transcription failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
