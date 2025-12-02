🏫 CMTC IT Chatbot — Node.js + LINE OA + Google Sheets + Gemini 2.5

A lightweight, single-file chatbot built in half a day — designed for the IT Department of Chiang Mai Technical College (CMTC).
It connects LINE Official Account, Google Sheets CSV, and Gemini 2.5 to create an AI assistant that answers questions about:
- Students
- Teachers & Guest Teachers
- Class schedule
- Subjects
- Rooms
- FAQs

Static department info (director, head of department, class reps, etc.)
This project also includes RAG-like semantic search using Gemini embeddings to match user questions with structured data.

🚀 Features
✔ LINE Official Account Webhook
Receives messages and replies with AI-generated answers.

✔ Google Sheets as Database
Loads multiple CSV sheets:
- Students
- Teachers
- Guest teachers
- Schedule
- Subjects
- FAQ
- Rooms

✔ Semantic Search (RAG)
All rows are converted into embeddings (text-embedding-004) and stored in a custom knowledge base.
User questions are compared with cosine similarity → returns the most relevant rows.

✔ Conversation Memory
Stores the last 10 messages per user to improve context and reduce confusion.

✔ Smart Query Analysis
Understands if the question is about:
- Students
- Teachers
- Subjects
- Rooms
- Schedule
Or general queries
Also detects “counting questions” like กี่คน, ทั้งหมด, จำนวน.

✔ Static College Metadata
Includes director name, IT department head, class reps, contact, and study schedule.

✔ API Endpoints
- GET /ask?text=... — Ask questions via browser
- POST /webhook — LINE Messaging API
- GET /reload-sheets — Reload Google Sheets data
- GET /stats — System stats

🧠 AI Models Used
gemini-2.5-flash: Answer generation
text-embedding-004: Search embeddings

🔧 Tech Stack
- Node.js
- Express.js
- LINE Bot SDK
- Google Sheets (CSV export)
- Gemini Generative AI
- Axios
- csv-parse

📂 Why One File?
Because the project was built fast and optimized for debugging with AI.
No unnecessary abstractions.
Everything in one place for quick iteration.
