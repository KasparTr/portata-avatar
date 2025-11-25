import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Serverless function to provide D-ID authentication credentials
 * This keeps the credentials secure on the server side
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const username = process.env.DID_USERNAME;
  const password = process.env.DID_PASSWORD;

  if (!username || !password) {
    console.error('DID_USERNAME or DID_PASSWORD not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Return the credentials for client-side Basic Auth token creation
    return res.status(200).json({
      username,
      password
    });
  } catch (error) {
    console.error('Error fetching D-ID credentials:', error);
    return res.status(500).json({
      error: 'Failed to fetch D-ID credentials',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
