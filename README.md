# GoodCalendar

A polished React + Vite scheduling web app starter for a Motion-inspired planner.

## Included scope
- Unlimited week scheduling range
- Unlimited Focus Time
- Unlimited Tasks
- Unlimited Buffer Time
- Supabase-ready persistence
- Vercel-friendly deployment

## Setup
1. Install dependencies:
   npm install
2. Copy environment variables:
   cp .env.example .env
3. Add your Supabase anon key in `.env`
4. Run the SQL in `supabase/schema.sql`
5. Start the app:
   npm run dev

## Deploy to Vercel
1. Push this project to your GitHub repo
2. Import the repo in Vercel
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel project settings
4. Deploy

## Notes
- The Supabase URL has already been prefilled from your request.
- The anon key is still required before cloud sync can work.
- Without the anon key, the app falls back to local demo data so the UI still renders nicely.
