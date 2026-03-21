This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Agent browser (`/api/run-agent`)

The UI calls Gemini in **two phases** when generating bash for `agent-browser`: a **structured JSON plan** (URL strategy, steps outline, risks), then a **lower-temperature** script that follows that plan. If planning fails, the API falls back to single-shot generation.

**Environment (optional):**

| Variable | Purpose |
| -------- | ------- |
| `GEMINI_API_KEY` | Required (or `GOOGLE_GENERATIVE_AI_API_KEY` / `GOOGLE_API_KEY`). |
| `AGENT_PLAN_MODEL` | Model for planning (default `gemini-2.5-flash`). |
| `AGENT_SCRIPT_MODEL` | Model for bash generation (default `gemini-2.5-flash`). |
| `AGENT_VISION_MODEL` | Model for screenshot verification + CSV extraction (default `gemini-2.5-flash`; `gemini-2.0-flash` is deprecated for new API keys). |
| `AGENT_SKIP_PLAN` | Set to `true` or `1` to skip the planner and use legacy one-shot prompts. |
| `AGENT_KEEP_NETWORKIDLE` | Set to `true` or `1` to **stop** rewriting `wait --load networkidle` → fixed ms (default: scripts are sanitized to avoid SPA hangs). |
| `AGENT_BROWSER_HEADED` | Default **headless** (no extra Chrome window). Set to `true` or `1` only to open a real **external** browser for debugging. Follow runs in the **in-app preview** (URLs from agent output). |

Manual test ideas: [docs/AGENT_BROWSER_TEST_PLAN.md](./docs/AGENT_BROWSER_TEST_PLAN.md).
