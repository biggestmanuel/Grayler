Grayler — Meeting Notes Summarizer

Quick start (dev):

1. Install dependencies:
   npm install

2. Run the API server (local proxy that uses GROQ if GROQ_API_KEY is set):
   npm run start-server

3. Run the frontend dev server:
   npm run dev

Notes:
- The server is a small Express proxy to keep your GROQ_API_KEY off the browser. Create a .env file from .env.example.
- For zero-cost local work you can use the fallback extractive mode; Groq gives higher quality summaries.
- This project is intentionally lightweight so it can be developed and hosted cheaply.

Next steps:
- Add audio upload + transcription step (Whisper or other STT) before summarization
- Add save/export of summaries
- Add authentication if you want private notes
# Grayler
