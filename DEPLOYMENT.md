# Deployment Guide

This guide explains how to securely deploy the Streaming Avatar Demo application to production.

## Security Overview

The application has been refactored to use a **backend proxy architecture** to protect API keys:

- ✅ All API keys remain server-side (never exposed to client)
- ✅ Frontend calls backend proxy endpoints at `/api/*`
- ✅ Backend proxy forwards requests to external APIs (HeyGen, ElevenLabs, Seeker)
- ✅ WebRTC streaming connection is still direct (no latency impact)

## Recommended Hosting Platforms

### Option 1: Vercel (Recommended - Easiest)

**Advantages:**
- Automatic deployments from Git
- Built-in serverless functions (already configured in `/api` folder)
- Easy environment variable management
- Free tier available
- Excellent performance (CDN + serverless in same region)

**Steps:**

1. **Install Vercel CLI** (optional, can also use web interface):
   ```bash
   npm install -g vercel
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Deploy to Vercel:**
   ```bash
   vercel
   ```

4. **Set Environment Variables** in Vercel dashboard:
   - Go to: Project Settings > Environment Variables
   - Add these variables:
     - `HEYGEN_API_KEY` = your HeyGen API key
     - `ELEVENLABS_API_KEY` = your ElevenLabs API key
     - `SEEKER_TOKEN` = your Seeker RAG token
   - Set for: Production, Preview, Development

5. **Redeploy** to apply environment variables:
   ```bash
   vercel --prod
   ```

### Option 2: Netlify

**Advantages:**
- Similar to Vercel
- Good free tier
- Easy Git integration

**Steps:**

1. **Install Netlify CLI:**
   ```bash
   npm install -g netlify-cli
   ```

2. **Create `netlify.toml` configuration:**
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"
     functions = "netlify/functions"

   [[redirects]]
     from = "/api/*"
     to = "/.netlify/functions/:splat"
     status = 200
   ```

3. **Move API functions** to Netlify format:
   - Create `netlify/functions/` directory
   - Convert Vercel functions to Netlify functions format

4. **Deploy:**
   ```bash
   netlify deploy --prod
   ```

5. **Set Environment Variables:**
   - Site Settings > Build & Deploy > Environment
   - Add: `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `SEEKER_TOKEN`

### Option 3: Railway / Render (Full Control)

**Advantages:**
- More control over backend
- Can run custom Node.js server
- Docker support

**Steps:**

1. **Create Express Server** (if needed for more complex backend)
2. **Deploy:**
   - Connect GitHub repository
   - Set environment variables
   - Deploy

## Local Development

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your API keys** in `.env`:
   ```
   HEYGEN_API_KEY=your_key_here
   ELEVENLABS_API_KEY=your_key_here
   SEEKER_TOKEN=your_token_here
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

   For Vercel local testing:
   ```bash
   vercel dev
   ```

## Security Checklist

Before deploying, ensure:

- [ ] `.env` file is in `.gitignore` (already configured)
- [ ] API keys use non-`VITE_` prefix (server-side only)
- [ ] Environment variables are set in hosting platform
- [ ] Test all features after deployment
- [ ] Monitor API usage to detect any abuse

## API Endpoints

The application uses these backend proxy endpoints:

- `POST /api/heygen-token` - Fetches HeyGen access token
- `POST /api/transcribe` - Proxies ElevenLabs speech-to-text
- `POST /api/seeker-query` - Proxies Seeker RAG queries

## Performance Notes

**Avatar Speed:** The backend proxy adds minimal latency (~10-50ms):
- Token fetch: One-time on session start
- Transcription: Background process, doesn't block avatar
- Seeker queries: On-demand user requests
- WebRTC stream: Direct connection (not proxied)

**Optimization:**
- Deploy frontend and backend in same region
- Use serverless functions (co-located with frontend)
- Keep proxy logic minimal (just forward requests)

## Troubleshooting

**Issue: API functions not working**
- Check environment variables are set correctly
- Check Vercel/Netlify function logs
- Ensure API keys are valid

**Issue: CORS errors**
- Check `vercel.json` has correct CORS headers
- Ensure API routes are properly configured

**Issue: Build fails**
- Run `npm install` to ensure dependencies are installed
- Check TypeScript compilation with `npm run build`

## Support

For issues or questions:
- Check browser console for errors
- Review serverless function logs in hosting dashboard
- Verify environment variables are set correctly
