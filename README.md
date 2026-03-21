# Recipie

Product Requirements Document for **ReplayAgent** — a platform that turns screen recordings into executable browser automation.

> *"Record once, automate forever."*

## PRD

📄 **[docs/PRD.md](docs/PRD.md)** — Full Product Requirements Document

## Summary

ReplayAgent enables users to:

1. Upload a video (or Loom URL) + context
2. Gemini analyzes the video → produces video artifacts
3. Video artifacts + chat context → stored in database
4. Builder agent derives an executable **recipe**
5. Vercel agents execute the recipe (agent-browser)

## Tech Stack (Planned)

- Next.js 15, React 19, TypeScript
- Gemini via Google Vertex AI
- agent-browser (Vercel Labs) for execution
- Database for artifacts + chat context
