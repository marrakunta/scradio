# CS-Radio MVP

Next.js + Supabase single-repo MVP for live SoundCloud session sync.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure env values from `.env.example`.
3. Apply SQL migration in Supabase (`supabase/migrations/20260210_000001_create_sessions.sql`).
4. Run development server:

```bash
npm run dev
```

## Core behavior

- State-based sync via one `sessions` row.
- Realtime listener updates via `UPDATE` subscription.
- Writes only through server API routes with host secret auth.
- Host lease/heartbeat for offline indication.
- Listener autoplay fallback button: `Start listening live`.
