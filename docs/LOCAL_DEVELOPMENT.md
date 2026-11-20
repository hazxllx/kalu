# Native local development

KALUSAGAP runs as a native React/Vite frontend and Node.js/Express backend.
It uses the existing Supabase project for Auth, PostgreSQL, Storage, and RLS.
No container runtime is required.

## Environment files

Create ignored `frontend/.env` and `backend/.env` files from their `.env.example`
templates. Configure both apps with the same existing Supabase project.

Frontend:

```env
VITE_APP_BASE_URL=http://localhost:5173
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-or-publishable-key>
VITE_SUPABASE_MODE=hosted-development
VITE_ANALYTICS_ENABLED=false
```

Backend:

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<public-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
SUPABASE_MODE=hosted-development
OTP_PEPPER=<random-32-byte-hex-value>
```

Never place `SUPABASE_SERVICE_ROLE_KEY` or another privileged credential in a
`VITE_` variable or in Git. The frontend uses only its public anon/publishable
key. RLS remains enabled.

## Start the application

Install dependencies and start each process separately:

```powershell
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:5173`. The backend uses `http://localhost:5000/api`.

## Production deployment

Set `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in Vercel.
Set backend credentials and service configuration in Render or the selected
native hosting provider. Redeploy after changing public environment variables.

Do not configure a service-role key for browser builds.
