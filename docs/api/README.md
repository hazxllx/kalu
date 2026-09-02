# API

Base URL: `http://localhost:5000/api` in development, configured in the frontend
through `VITE_API_URL`.

## Implemented

| Method | Endpoint      | Description                        | Auth |
| ------ | ------------- | ---------------------------------- | ---- |
| GET    | `/api/health` | Confirms the API process is running | none |

```bash
curl http://localhost:5000/api/health
```

```json
{
  "status": "ok",
  "message": "KALUSAGAP backend is running"
}
```

Nothing else exists yet. The React app still reads from
`frontend/src/services/mock/`.

## Planned endpoints

Keep these names exactly as written so the frontend, docs, and Postman
collection do not drift apart:

```text
/api/auth              /api/consultations       /api/reports
/api/users             /api/health-records      /api/notifications
/api/residents         /api/risk-assessments
/api/households        /api/follow-ups
```

## Conventions

- Plural, kebab-case paths: `/api/health-records`, `/api/follow-ups`.
- `GET` read · `POST` create · `PUT` replace · `PATCH` partial update · `DELETE` remove.
- Collection: `GET /api/residents`. Single item: `GET /api/residents/:id`.
  Nested: `GET /api/residents/:id/health-records`.
- Filtering, paging, and sorting go in the query string:
  `?barangay=san-jose&page=2&limit=20&sort=-created_at`.
- No verbs in paths. `POST /api/follow-ups/:id/complete` is acceptable for a
  state transition that is not a plain update; `POST /api/getResidents` is not.

## Response shape

Success:

```json
{ "data": { } }
```

Error (produced by `backend/src/middleware/errorHandler.js`):

```json
{ "error": { "message": "Resident not found" } }
```

Status codes: `200` ok · `201` created · `204` deleted · `400` validation ·
`401` not authenticated · `403` wrong role · `404` missing · `409` conflict ·
`500` unexpected.

## Privacy

Return only the fields a screen needs — never spread a whole database row into a
response. List endpoints for wide audiences should omit identifiers such as full
address, contact number, and diagnosis details. Never place personal or health
information in a URL path or query string, since those end up in server logs.

## Postman

Keep one collection per feature group, using a `{{baseUrl}}` variable rather than
hardcoded hosts, and store tokens in a Postman environment — not in the exported
collection file.
