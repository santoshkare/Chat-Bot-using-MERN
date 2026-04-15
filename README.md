# AI Chatbot for Customer Support (MERN + OpenRouter)

A complete customer-support chatbot project with:

- OpenRouter-based chat responses
- Session history storage in MongoDB
- Analytics dashboard (accuracy/confidence, rating, traffic trend)
- Training visibility and Q&A training sample management
- Feedback capture for each bot response

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB
- AI API: OpenRouter

## Folder Structure

- client: React frontend dashboard + chat UI
- server: Express APIs, MongoDB models, analytics, training APIs

## Setup

1. Start MongoDB locally
2. Configure backend environment:
   - Copy `server/.env.example` to `server/.env`
   - Add your real `OPENROUTER_API_KEY`
3. Install dependencies:

```bash
cd server
npm install
cd ../client
npm install
```

4. Run backend:

```bash
cd server
npm run dev
```

5. Run frontend:

```bash
cd client
npm run dev
```

6. Open frontend:

- http://localhost:5173
- If 5173 is in use, Vite automatically picks another port and shows it in terminal.

## Important API Endpoints

- `GET /api/health`
- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId/messages`
- `POST /api/chat`
- `POST /api/messages/:messageId/feedback`
- `GET /api/analytics/overview`
- `GET /api/analytics/trend?days=14`
- `POST /api/training/seed-common`
- `POST /api/training/samples`
- `GET /api/training/samples`
- `GET /api/training/stats`

## Notes

- If OpenRouter key is not configured, the chatbot returns fallback answers from local training samples where possible.
- The dashboard still works and can show analytics from stored session data.
