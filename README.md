# Streaming Avatar Demo

An interactive AI avatar demo application with real-time speech transcription and RAG (Retrieval-Augmented Generation) capabilities.

## Features

- 🎥 **Live Avatar Streaming** - Interactive AI avatar powered by HeyGen
- 🎤 **Real-time Transcription** - Speech-to-text using ElevenLabs
- 🧠 **RAG Integration** - Knowledge base queries via Seeker
- 🔒 **Secure Architecture** - Backend proxy protects API keys
- ⚡ **Low Latency** - WebRTC for direct streaming connections

## Security

✅ **Production-Ready & Secure**

All API keys are protected by a backend proxy architecture:
- API keys never exposed to client-side code
- Serverless functions handle all external API calls
- No sensitive data in JavaScript bundle
- Safe to deploy to public hosting platforms

See [SECURITY.md](SECURITY.md) for detailed security information.

## Quick Start

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repository-url>
   cd streaming-avatar-demo
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

3. **Run development server:**
   ```bash
   # For standard Vite dev server:
   npm run dev

   # For Vercel local testing (recommended):
   npx vercel dev
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Deployment

### Deploy to Vercel (Recommended)

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Set environment variables** in Vercel dashboard:
   - `HEYGEN_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `SEEKER_TOKEN`

4. **Redeploy:**
   ```bash
   vercel --prod
   ```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions and other hosting options.

## Architecture

```
Frontend (Vite + TypeScript)
    ↓
Backend Proxy (/api/* serverless functions)
    ↓
External APIs (HeyGen, ElevenLabs, Seeker)
```

## Tech Stack

- **Frontend:** Vite, TypeScript, Pico CSS
- **Avatar:** HeyGen Streaming Avatar SDK
- **Transcription:** ElevenLabs Speech-to-Text
- **RAG:** Seeker Knowledge Base
- **Deployment:** Vercel Serverless Functions

## Environment Variables

```bash
# Server-side only (never exposed to client)
HEYGEN_API_KEY=your_heygen_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
SEEKER_TOKEN=your_seeker_token
```

## Project Structure

```
streaming-avatar-demo/
├── api/                      # Backend serverless functions
│   ├── heygen-token.ts      # HeyGen token endpoint
│   ├── transcribe.ts        # ElevenLabs proxy
│   └── seeker-query.ts      # Seeker RAG proxy
├── src/                     # Frontend source code
│   ├── main.ts             # Main application logic
│   ├── constants.ts        # Configuration constants
│   ├── audioTranscriptionService.ts
│   ├── seekerService.ts
│   └── knowledgeBaseService.ts
├── public/                 # Static assets
├── vercel.json            # Vercel configuration
├── .env.example           # Environment template
├── DEPLOYMENT.md          # Deployment guide
└── SECURITY.md            # Security documentation
```

## API Endpoints

### Backend Proxy Endpoints

- `POST /api/heygen-token` - Fetch HeyGen access token
- `POST /api/transcribe` - Transcribe audio to text
- `POST /api/seeker-query` - Query knowledge base

## Performance

- **Token Fetch:** One-time on session start (~100ms)
- **Transcription:** Background processing (no blocking)
- **Seeker Queries:** ~200-500ms (on-demand)
- **Avatar Stream:** Direct WebRTC (no proxy latency)

## Contributing

Contributions are welcome! Please ensure:
- Security best practices are maintained
- No API keys in code or commits
- All sensitive config uses environment variables

## License

[Add your license here]

## Support

For issues or questions, please open a GitHub issue.