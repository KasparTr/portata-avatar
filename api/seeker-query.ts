import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Message history item for Seeker RAG system
 */
interface SeekerMessage {
  role: 'assistant' | 'user';
  content: string;
}

/**
 * Request body from client
 */
interface ClientRequest {
  prompt: string;
  msgHistory: SeekerMessage[];
  namespace?: string;
  role?: string;
}

/**
 * Serverless function to proxy Seeker RAG queries
 * This keeps the Seeker token secure on the server side
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const seekerToken = process.env.SEEKER_TOKEN;

  if (!seekerToken) {
    console.error('SEEKER_TOKEN not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { prompt, msgHistory, namespace = 'ehr', role = 'Customer support' } = req.body as ClientRequest;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Prepare request body for Seeker API
    const seekerRequest = {
      ns: namespace,
      token: seekerToken,
      prompt: prompt,
      role: role,
      msgHistory: msgHistory || []
    };

    const response = await fetch('https://seeker.aveotech.com/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(seekerRequest)
    });

    if (!response.ok) {
      throw new Error(`Seeker API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Return the Seeker response
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error in Seeker proxy:', error);
    return res.status(500).json({
      error: 'Seeker query failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
