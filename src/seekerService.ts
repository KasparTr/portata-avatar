import { API_ENDPOINTS, SEEKER_CONFIG } from './constants';

/**
 * Message history item for Seeker RAG system
 */
export interface SeekerMessage {
  role: 'assistant' | 'user';
  content: string;
}

/**
 * Request body for Seeker query
 */
interface SeekerQueryRequest {
  ns: string;
  token: string;
  prompt: string;
  role: string;
  msgHistory: SeekerMessage[];
}

/**
 * Request body for Seeker context
 */
interface SeekerContextRequest {
  ns: string;
  token: string;
  prompt: string;
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
    // Get token from environment variable
    const token = import.meta.env.VITE_SEEKER_TOKEN;
    
    if (!token) {
      throw new Error('VITE_SEEKER_TOKEN environment variable is not set');
    }

    // Prepare request body
    const requestBody: SeekerQueryRequest = {
      ns: SEEKER_CONFIG.NAMESPACE,
      token: token,
      prompt: prompt,
      role: SEEKER_CONFIG.ROLE,
      msgHistory: msgHistory
    };

    // Make POST request to Seeker
    const response = await fetch(API_ENDPOINTS.SEEKER_QUERY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Seeker API request failed: ${response.status} ${response.statusText}`);
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
    const token = import.meta.env.VITE_SEEKER_TOKEN;
    
    if (!token) {
      throw new Error('VITE_SEEKER_TOKEN environment variable is not set');
    }

    const requestBody: SeekerQueryRequest = {
      ns: namespace,
      token: token,
      prompt: prompt,
      role: SEEKER_CONFIG.ROLE,
      msgHistory: msgHistory || [
        {
          role: "assistant",
          content: "Oled nüüd režiimis 'Ehitamisega seotud küsimused'. Režiimi saad muuta menüüst. Seniks esita oma küsimused siia.?"
        }
      ]
    };

    const response = await fetch(API_ENDPOINTS.SEEKER_QUERY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Seeker API request failed: ${response.status} ${response.statusText}`);
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
 * Get relevant context from Seeker RAG system
 * 
 * @param prompt - The user's speech text to get context for
 * @returns Promise with the relevant context string
 * 
 * @example
 * ```typescript
 * const context = await getRelevantContext("What are the building regulations?");
 * console.log(context);
 * ```
 */
export async function getRelevantContext(prompt: string): Promise<string> {
  try {
    // Get token from environment variable
    const token = import.meta.env.VITE_SEEKER_TOKEN;
    
    if (!token) {
      throw new Error('VITE_SEEKER_TOKEN environment variable is not set');
    }

    // Prepare request body
    const requestBody: SeekerContextRequest = {
      ns: SEEKER_CONFIG.NAMESPACE,
      token: token,
      prompt: prompt
    };

    // Make POST request to Seeker context endpoint
    const response = await fetch(API_ENDPOINTS.SEEKER_CONTEXT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Seeker context request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Return the context string (adjust based on actual API response format)
    return data.context || data.reply || JSON.stringify(data);

  } catch (error) {
    console.error('Error getting relevant context from Seeker:', error);
    return ''; // Return empty string on error
  }
}
