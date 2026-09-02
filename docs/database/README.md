# Database documentation

The schema, migrations, seeds, and Row Level Security guidance live in
[`/database`](../../database/README.md) so there is exactly one source of truth.

This folder is for written database documentation that is not SQL — for example
an entity-relationship diagram, a data dictionary, or the retention and privacy
rules for health records.

Nothing here yet. When the schema exists, add:

- `erd.md` (or an exported diagram) — entities and relationships.
- `data-dictionary.md` — every table and column, with the sensitivity of each
  field noted so it is obvious which columns must never reach a wide-audience
  API response.
