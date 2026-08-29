# Veltrix AI

> Your inbox, intelligently simplified. Veltrix AI reads, summarizes, and drafts replies — all on-device.

![Veltrix AI](https://img.shields.io/badge/Status-Active-success.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

Veltrix AI is a lightweight, frontend-only email client that connects securely to your Gmail account. It utilizes local AI to process your emails, providing instant summaries, extracting actionable tasks, and generating tailored reply drafts without compromising your privacy.

## ✨ Features

- **Intelligent Summarization:** Condenses long, jargon-heavy threads into crisp bullet points and clear action verdicts.
- **Tone-Aware Drafting:** Generates replies in professional, friendly, formal, or concise voices. Drafts are fully editable and never auto-sent.
- **On-Device Analysis:** Your email contents are processed locally in your browser. Tokens stay in memory and are never persisted to a remote backend.
- **Advanced Gmail Search:** Full support for Gmail search operators (`from:`, `has:attachment`, `is:unread`, etc.).
- **Action Extraction:** Automatically identifies tasks, deadlines, and commitments and formats them into a structured checklist.
- **Secure Authentication:** 
  - **Supabase:** Primary email/password authentication.
  - **Google OAuth 2.0 (PKCE):** Direct, secure connection to Gmail APIs without requiring a middleman server.
- **Beautiful, Responsive UI:** Custom design system built with Vanilla CSS, featuring smooth micro-animations, glassmorphism, and seamless light/dark mode support.

## 🚀 Getting Started

Since Veltrix AI is a purely static SPA (Single Page Application), running it locally is incredibly fast and simple.

### Prerequisites

- Node.js (for the local development server)
- A Supabase Project (URL and Anon Key)
- A Google Cloud Project (OAuth Client ID with Gmail APIs enabled)

### Installation

1. **Clone the repository**
   \`\`\`bash
   git clone https://github.com/Premkumar1845/Veltrix-AI.git
   cd Veltrix-AI
   \`\`\`

2. **Configure Credentials**
   Open \`js/config.js\` and insert your keys:
   \`\`\`javascript
   export const config = {
     clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
     supabaseUrl: 'https://YOUR_SUPABASE_PROJECT.supabase.co',
     supabaseKey: 'YOUR_SUPABASE_ANON_KEY',
     // ...
   };
   \`\`\`

3. **Run the Development Server**
   Start the local server using `npx serve`:
   \`\`\`bash
   npm run dev
   \`\`\`

4. Open your browser and navigate to \`http://localhost:3000\`.

## 🛠️ Technology Stack

- **Core:** HTML5, Vanilla JavaScript (ES6 Modules)
- **Styling:** Custom Vanilla CSS (No frameworks, tailored design tokens)
- **Authentication:** Supabase Auth (JS Client), Google Identity Services (OAuth 2.0)
- **Email Provider:** Gmail REST API

## 🔒 Privacy & Security

Veltrix AI is designed with a privacy-first architecture:
- **No Middleman Servers:** The app communicates directly with Google's Gmail APIs from the client-side.
- **Ephemeral Credentials:** OAuth access tokens are kept in memory and are not stored in databases or local storage.
- **Local AI:** Email summarization and processing are executed locally on-device.

## 📄 License

This project is licensed under the MIT License.
