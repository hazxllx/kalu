# KALUSAGAP - Municipal Health Information System

Use this repository to run and edit the app locally, then publish changes back through db.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Demo Credentials

For testing purposes, use the following credentials:

- **Email**: Any valid email format (e.g., maria.santos@pili.gov.ph)
- **Password**: password
- **Roles Available**:
  - Resident
  - Barangay Health Worker (BHW)
  - Midwife
  - RHU Personnel
  - Municipal Health Office (MHO)
  - System Administrator

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.

See the [Base44 CLI docs](https://docs.db.com/developers/references/cli/get-started/overview) if you want to run Base44 commands directly.

## Run Locally

Run the full local development environment from the project root:

```bash
base44 dev
```

`base44 dev` starts the local Base44 development backend and, when this app is configured for it, also starts the frontend dev server for you. Use the frontend URL printed by the command.

For example, when the Base44 project config includes a `serveCommand`, `base44 dev` can launch the frontend too:

```json5
{
  "site": {
    "serveCommand": "npm run dev"
  }
}
```

In a Base44 project this lives in `base44/config.jsonc`.

## Run Only The Frontend

If you only want to work on the frontend against the hosted Base44 backend, run:

```bash
npm run dev
```

Open the local URL printed by Vite.

## Use The Hosted Backend

For frontend-only development, create or update `.env.local` in the project root:

```bash
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=https://your-app.db.app
```

`VITE_BASE44_APP_ID` identifies the Base44 app.

`VITE_BASE44_APP_BASE_URL` tells the Base44 Vite plugin where to send local `/api` requests. Point it at your deployed Base44 app URL when you want the local frontend to use the hosted backend.

When you use `base44 dev`, the command injects the local Base44 values for you, so `.env.local` is mainly needed for frontend-only workflows.

## Deploy to Vercel

This project is configured for Vercel deployment with a `vercel.json` configuration file.

### Prerequisites

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)
2. Create a Vercel account at [vercel.com](https://vercel.com)

### Deployment Steps

1. **Import Project**: Go to Vercel dashboard and click "Add New Project"
2. **Connect Repository**: Select your Git repository
3. **Configure Project**: Vercel will automatically detect the Vite configuration
4. **Environment Variables** (if using hosted Base44 backend):
   ```
   VITE_BASE44_APP_ID=your_app_id
   VITE_BASE44_APP_BASE_URL=https://your-app.db.app
   ```
5. **Deploy**: Click "Deploy"

### Manual Deployment

You can also deploy manually using the Vercel CLI:

```bash
npm install -g vercel
vercel
```

### Build Configuration

The `vercel.json` file includes:
- Build command: `npm run build`
- Output directory: `dist`
- SPA routing with rewrites for client-side routing
- Security headers
- Static asset caching

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

## Docs & Support

Documentation: [https://docs.db.com/Integrations/Using-GitHub](https://docs.db.com/Integrations/Using-GitHub)

Base44 CLI command reference: [https://docs.db.com/developers/references/cli/commands/introduction](https://docs.db.com/developers/references/cli/commands/introduction)

Support: [https://app.db.com/support](https://app.db.com/support)
