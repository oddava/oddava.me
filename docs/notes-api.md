# Notes API

A token-authenticated API for creating and updating notes from something that
is not the browser admin panel: an Obsidian plugin, a small CLI, maybe a
Telegram bot later. Studio at `/admin/studio` is unchanged and still uses its
session cookie.

The API is off until `NOTES_API_TOKEN` is set. Every route then answers
`503` with `{"code":"notes_api_disabled"}`. A placeholder such as
`your_notes_api_token` counts as unset, same as the other secrets in
`.env.example`.

## Set the token

Locally, put a long random value in `.env` (not the admin panel token):

```bash
openssl rand -hex 32
```

In production the value is a Cloudflare secret. From the repo root, after
`pnpm exec wrangler login`:

```bash
pnpm exec wrangler secret put NOTES_API_TOKEN
```

Wrangler prompts for the value so it does not land in the shell history.
Setting the secret redeploys the Worker. Do not commit the value, and do not
reuse `ADMIN_PANEL_TOKEN`. A leaked plugin token should not also open Studio.

The API also needs the usual note store (Redis) and `COMMUNITY_SIGNING_SECRET`.
Rate limiting signs the client IP with that secret, so a missing or
placeholder signing secret makes requests fail with `503` even when the
bearer token is right.

## Authentication

Send the token on every request:

```
Authorization: Bearer <NOTES_API_TOKEN>
```

There is no cookie and no same-origin check on these routes. Obsidian and a
phone do not share the site's origin, and they cannot hold the Studio
session cookie. Browsers still will not call this API from another website:
responses do not send `Access-Control-Allow-Origin`, so a page on a foreign
origin cannot read them. The admin API under `/api/admin` still requires the
session cookie and, for writes, the same origin. This token does not unlock
those routes.

A missing or wrong token is `401` with `{"code":"unauthorized"}`. The two
cases use the same body. The comparison hashes both strings and then compares
the digests in constant time, so the secret's length is not leaked by how
fast the `401` comes back.

Requests are limited to 120 per minute per client. Over the limit the
response is `429` with `Retry-After`.

## Notes are still the Redis notes

Writes go through the same content store as Studio. That means the mutation
lock, the content version, compare-and-set revisions, and the note frontmatter
schema all apply. This API does not talk to Redis on its own.

A note's identity is its path inside the garden, not a numeric id:

```
diary/hello.md          →  src/content/notes/diary/hello.md
```

You can send that path as `diary/hello`, `diary/hello.md`, or the full
`src/content/notes/diary/hello.md`. Segments are lowercase kebab-case
(`reading/atomic-habits`, `diary/06-10-2026`). `..`, spaces, uppercase, and
extensions other than `.md` are rejected.

File names are unique across the whole garden, not just inside one folder.
Studio looks a note up by its file name, so `diary/hello.md` and
`reading/hello.md` cannot both exist. The second create returns `409` with
`code: "slug_exists"`.

Frontmatter may only contain `title`, `icon`, `order`, and `updated`. Other
keys (Obsidian tags, aliases, and so on) are dropped on save. The writing
itself lives in the Markdown body. The first heading becomes the title when
`title` is omitted. On every save the server sets `updated` to the current
time. On create, a missing `order` is filled in so the note sorts at the end
of its folder in Studio. On update, a missing `order` keeps the stored value
so a client that does not know about `order` does not reshuffle the folder.

New folders do not need to exist first. Saving `projects/idea.md` creates the
folder in the store. It does not create a folder page (`projects.md`). Add
that page yourself if the folder should have an intro note in the garden.

There is no delete. Removing a note stays in Studio, which already knows the
folder rules (a folder page, a folder that still has notes in it).

`GET /api/notes/search` is the public search endpoint. It is not part of this
API and does not take the bearer token. A note file named `search.md` is
fetched at `/api/notes/search.md`.

## Endpoints

All bodies are JSON. The maximum body size is 1 MB. Responses are
`Cache-Control: no-store`.

| Method | Path                | What it does                                                      |
| ------ | ------------------- | ----------------------------------------------------------------- |
| `GET`  | `/api/notes`        | List notes: `path`, `title`, `updated`, `revision`. No body text. |
| `POST` | `/api/notes`        | Create a note. `409` if the path or file name already exists.     |
| `GET`  | `/api/notes/<path>` | Fetch one note, including its Markdown `content`.                 |
| `PUT`  | `/api/notes/<path>` | Update that note. Does not create a missing note.                 |

`revision` is the version. It changes on every successful write. Send it back
on update when you have it. If the stored revision is different, nothing is
written and the response is `409` with `code: "revision_conflict"` and the
current `note` (including the new `revision`). Fetch again, decide what to
keep, and retry.

Omit `revision` on `PUT` only when you mean "overwrite whatever is there".
That still compare-and-sets against the revision the server just read, under
the same lock Studio uses, so two writes cannot pass through each other. It
will replace a Studio edit you have not seen.

`POST` does not take a revision. Creating means the path must not exist. A
retry after a lost response gets `409` with `code: "path_exists"` and the
current note, which is how you tell the first request landed.

## Examples

List:

```bash
curl -s https://oddava.me/api/notes \
  -H "Authorization: Bearer $NOTES_API_TOKEN"
```

```json
{
  "notes": [
    {
      "path": "diary/hello.md",
      "title": "hello",
      "updated": "2026-10-29T18:00:00.000Z",
      "revision": "r6f1c0a"
    }
  ]
}
```

Create:

```bash
curl -s https://oddava.me/api/notes \
  -H "Authorization: Bearer $NOTES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"diary/hello.md","content":"# hello\n\nstill learning."}'
```

`201` returns the saved note. `content` is the canonical Markdown, which may
differ from what you sent because `updated` and `order` were filled in. Store
that `revision` (and, if you mirror the file locally, that `content`).

Fetch:

```bash
curl -s https://oddava.me/api/notes/diary/hello.md \
  -H "Authorization: Bearer $NOTES_API_TOKEN"
```

Update:

```bash
curl -s -X PUT https://oddava.me/api/notes/diary/hello.md \
  -H "Authorization: Bearer $NOTES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# hello\n\nupdated from the phone.","revision":"r6f1c0a"}'
```

A sync pass that will not clobber Studio:

1. `GET /api/notes` and compare each `revision` with the one you stored last time.
2. `GET` any note whose revision changed, and merge it locally.
3. `PUT` local edits with the revision you last fetched.
4. On `409`, fetch again and merge. Do not retry the same revision in a loop.
5. `POST` notes that do not exist on the server yet. On `409`, the server already has that path; fetch it instead of creating it again.

## Errors

| Status | `code`                      | When                                                                       |
| ------ | --------------------------- | -------------------------------------------------------------------------- |
| `400`  | `invalid_path`              | Path is missing or not a kebab-case `.md` note.                            |
| `400`  | `invalid_content`           | `content` is missing or not a string.                                      |
| `400`  | `invalid_revision`          | `revision` is present and not a string.                                    |
| `400`  | `invalid_request`           | The body is not a JSON object.                                             |
| `400`  | `validation_failed`         | Frontmatter does not match the note schema. `issues` lists the fields.     |
| `401`  | `unauthorized`              | Missing or wrong bearer token.                                             |
| `404`  | `not_found`                 | `PUT` or `GET` for a path that is not a note yet.                          |
| `405`  | `method_not_allowed`        | Delete, and anything else this API does not do. `Allow` lists the methods. |
| `409`  | `path_exists`               | Create, but that path is already a note. `note` is the current one.        |
| `409`  | `slug_exists`               | Create, but that file name is used at another path.                        |
| `409`  | `revision_conflict`         | Update, and `revision` does not match. `note.revision` is the current one. |
| `413`  | `payload_too_large`         | Body is over 1 MB.                                                         |
| `429`  | `rate_limited`              | More than 120 requests in a minute.                                        |
| `503`  | `notes_api_disabled`        | `NOTES_API_TOKEN` is not set.                                              |
| `503`  | `content_store_unavailable` | Redis is not configured or could not be reached.                           |
| `503`  | `content_busy`              | Another save holds the content lock. `Retry-After: 1`.                     |
| `503`  | `rate_limit_unavailable`    | Rate limiting could not run (usually the signing secret or Redis).         |
