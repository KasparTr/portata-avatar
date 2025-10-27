import { API_ENDPOINTS, SEEKER_CONFIG } from './constants';

/**
 * Message history item for Seeker RAG system
 */
export interface SeekerMessage {
  role: 'assistant' | 'user';
  content: string;
}


/**
 * Raw API response from Seeker query
 */
interface SeekerAPIResponse {
  process_duration: number;
  reply: string;
}

/**
 * Response from Seeker query (simplified to just return the reply string)
 */
export interface SeekerQueryResponse {
  reply?: string;
  error?: string;
}

/**
 * Query the Seeker RAG system
 * 
 * @param prompt - The user's question/prompt
 * @param msgHistory - Optional message history for context (defaults to initial greeting)
 * @returns Promise with the Seeker response
 * 
 * @example
 * ```typescript
 * const response = await querySeekerRAG("What are the building regulations?");
 * console.log(response.reply);
 * ```
 */
export async function querySeekerRAG(
  prompt: string,
  msgHistory: SeekerMessage[] = [
    {
      role: "assistant",
      content: "Oled nüüd režiimis 'Ehitamisega seotud küsimused'. Režiimi saad muuta menüüst. Seniks esita oma küsimused siia.?"
    }
  ]
): Promise<SeekerQueryResponse> {
  try {
    // Prepare request body for backend proxy
    const requestBody = {
      prompt: prompt,
      msgHistory: msgHistory,
      namespace: SEEKER_CONFIG.NAMESPACE,
      role: SEEKER_CONFIG.ROLE
    };

    // Make POST request to backend proxy (no token needed on client side)
    const response = await fetch(API_ENDPOINTS.SEEKER_QUERY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Backend proxy request failed: ${response.status} ${response.statusText}`);
    }

    const data: SeekerAPIResponse = await response.json();
    return { reply: data.reply };

  } catch (error) {
    console.error('Error querying Seeker RAG system:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Query Seeker with custom namespace
 * 
 * @param prompt - The user's question/prompt
 * @param namespace - Custom namespace to use
 * @param msgHistory - Optional message history for context
 * @returns Promise with the Seeker response
 */
export async function querySeekerWithNamespace(
  prompt: string,
  namespace: string,
  msgHistory?: SeekerMessage[]
): Promise<SeekerQueryResponse> {
  try {
    const requestBody = {
      prompt: prompt,
      msgHistory: msgHistory || [
        {
          role: "assistant",
          content: "Oled nüüd režiimis 'Ehitamisega seotud küsimused'. Režiimi saad muuta menüüst. Seniks esita oma küsimused siia.?"
        }
      ],
      namespace: namespace,
      role: SEEKER_CONFIG.ROLE
    };

    const response = await fetch(API_ENDPOINTS.SEEKER_QUERY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Backend proxy request failed: ${response.status} ${response.statusText}`);
    }

    const data: SeekerAPIResponse = await response.json();
    return { reply: data.reply };

  } catch (error) {
    console.error('Error querying Seeker RAG system:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
