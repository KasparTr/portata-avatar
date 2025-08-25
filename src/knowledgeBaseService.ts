import { KNOWLEDGEBASE_BASE } from "./constants";

export interface KnowledgeBaseConfig {
  apiKey: string;
  knowledgeId?: string;
  baseUrl?: string;
}

export class KnowledgeBaseService {
  private apiKey: string;
  private knowledgeId?: string;
  private baseUrl: string;

  constructor(config: KnowledgeBaseConfig) {
    this.apiKey = config.apiKey;
    this.knowledgeId = config.knowledgeId;
    this.baseUrl = config.baseUrl || 'https://api.heygen.com/v1';
  }

  /**
   * Update knowledge base with new transcription content
   */
  async updateKnowledgeBase(content: string): Promise<void> {
    if (!this.knowledgeId) {
      console.warn('Knowledge base ID not set.');
      return;
    }

    try {
      // Build complete knowledge base content
      const fullContent = this.buildKnowledgeBaseContent(content);

      // Update via HeyGen API
      const response = await fetch(`${this.baseUrl}/streaming/knowledge_base/${this.knowledgeId}`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
            name: "Telia Digital Hub",
            opening: "Hi there, I am Alice. The newest member of Portata.",
            prompt: fullContent,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update knowledge base: ${response.status} ${response.statusText} - ${errorText}`);
      }

      console.log('Knowledge base updated successfully via HeyGen API');
      
    } catch (error) {
      console.error('Error updating knowledge base:', error);
      throw error;
    }
  }

  /**
   * Create a new knowledge base
   */
  async createKnowledgeBase(name: string, opening: string, content: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/knowledge_base/create`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: name,
            opening: opening,
            prompt: content,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create knowledge base: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const knowledgeId = data.data?.knowledge_base_id;
      
      if (!knowledgeId || typeof knowledgeId !== 'string') {
        throw new Error('No valid knowledge base ID returned from API');
      }

      this.knowledgeId = knowledgeId;
      console.log('Knowledge base created:', this.knowledgeId);
      return this.knowledgeId;
      
    } catch (error) {
      console.error('Error creating knowledge base:', error);
      throw error;
    }
  }


  /**
   * Build complete knowledge base content
   */
  private buildKnowledgeBaseContent(content: string): string {
    return KNOWLEDGEBASE_BASE + content;
  }


  /**
   * Set knowledge base ID
   */
  setKnowledgeId(knowledgeId: string): void {
    this.knowledgeId = knowledgeId;
  }

  /**
   * Get current knowledge base ID
   */
  getKnowledgeId(): string | undefined {
    return this.knowledgeId;
  }
}
