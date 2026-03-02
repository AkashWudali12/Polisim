# Polisim

**AI agents for constructive political debate.** Polisim explores whether AI can debate political issues in a structured, research-driven way — with the goal of finding practical compromises instead of escalating conflict.

## What it does

- **Describe a political issue** — You give a prompt; the system turns it into a clear, debate-ready policy question.
- **Create two AI personas** — You define custom ideologies (e.g. left/right, progressive/conservative).
- **Run a structured debate** — Two agents research independently, challenge each other’s assumptions, then negotiate toward a solution.

The pipeline: **problem generation** → **research** (web search + evidence) → **crossfire** (structured Q&A) → **negotiation** (compromise while staying in character). Output is a research-backed debate focused on reasoning and solution-building.

## Running locally

### 1. API keys

You need:

- **OpenAI API key** – for the debate/research agents. Get one at [platform.openai.com](https://platform.openai.com/api-keys).
- **Tavily API key** – for web search. Get one at [tavily.com](https://tavily.com).
- **Redis credentials** – for shared job storage in serverless deployments (Upstash recommended on Vercel).

### 2. Environment file

Create a `.env.local` file in the project root with:

```bash
OPENAI_API_KEY=your_openai_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

If you are not using Upstash naming, you can also provide:

```bash
REDIS_URL=your_redis_url
REDIS_TOKEN=your_redis_token
```

Do not commit `.env.local`; it is already in `.gitignore`.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech

Built with **Next.js** and **Vercel’s AI SDK** (`generateText`, structured outputs, tool-calling). Research uses the **Tavily** API for search and content extraction. A context store (summaries + IDs) keeps agent prompts bounded during long research and debate loops.
