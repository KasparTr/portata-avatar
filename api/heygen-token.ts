import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Serverless function to fetch HeyGen access token
 * This keeps the API key secure on the server side
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    console.error('HEYGEN_API_KEY not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const response = await fetch(
      'https://api.heygen.com/v1/streaming.create_token',
      {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
      }
    );

    if (!response.ok) {
      throw new Error(`HeyGen API error: ${response.status}`);
    }

    const data = await response.json();

    // Return the token data
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching HeyGen token:', error);
    return res.status(500).json({
      error: 'Failed to fetch access token',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
