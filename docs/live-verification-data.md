# Live verification runs against the KALUSAGAP Supabase project

Project: `lblawqeoixojyytkmfqy`

The harnesses in this repo run against the **real** database, not a mock. This
file records what they leave behind so live data is never mistaken for real
operational records.

## `backend/scripts/verify-live-workflows.mjs` — `npm run verify:live`

Run with the API already listening:

```
cd backend
node src/server.js                      # terminal 1
npm run verify:live                     # terminal 2
```

Writes, once per run:

| Artifact | Identifying marker |
| --- | --- |
| QA personnel account + profile (status `pending_verification`, then approved) | `*.qa.<timestamp>@kalusagap.test` email |
| Auth identity for that account (email confirmed) | same email |
| One health referral | `QA <timestamp>` notes |
| One medical certificate | `QA <timestamp>` remarks |
| `audit_logs` / `system_logs` rows for the above | request paths under `/api/staff-accounts`, `/api/medical-certificates` |

It never deletes rows. Repeating the run accumulates one more set of the above.

## `backend/scripts/provision-official-accounts.mjs`

Dry-run by default. Only with `--apply` does it create the fixed operational
accounts (`admin@`, `mho@`, `phn@`, `supervisor@`, `rhu.personnel@`,
`bhw.`, `resident.user@kalusagap.test` …). These are **not** QA data — they are
the intended system accounts.

## Cleaning up

There is no automated cleanup script, deliberately: deleting QA rows by pattern
risks touching real records. The QA artifacts are identifiable by the markers
above, so review and remove them by hand when the live project is handed over.
