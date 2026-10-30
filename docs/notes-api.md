# Notes API

A token-authenticated API for creating, updating, renaming, and soft-deleting
notes from something that is not the browser admin panel: an Obsidian plugin,
a small CLI, maybe a Telegram bot later. Studio at `/admin/studio` is unchanged
and still uses its session cookie. Renames and deletes made here do not show
up in Studio's file tree: a renamed note is just the note at its new path, and
a deleted note is in the trash, not the garden.

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

Renaming and deleting go through this API so a client can follow what happened
in the vault. Studio can still rename and hard-delete on its own; those Studio
actions do not record a public redirect or a trash entry.

`GET /api/notes/search` is the public search endpoint. It is not part of this
API and does not take the bearer token. A note file named `search.md` is
fetched at `/api/notes/search.md`. The same is true of `move.md` and
`restore.md`: `POST /api/notes/move` and `POST /api/notes/restore` are actions,
so those two notes are fetched at `/api/notes/move.md` and
`/api/notes/restore.md`.

## Endpoints

All bodies are JSON. The maximum body size is 1 MB. Responses are
`Cache-Control: no-store`.

| Method   | Path                 | What it does                                                                |
| -------- | -------------------- | --------------------------------------------------------------------------- |
| `GET`    | `/api/notes`         | List live notes, plus trashed notes under `deleted`. No body text.          |
| `POST`   | `/api/notes`         | Create a note. `409` if the path or file name already exists.               |
| `GET`    | `/api/notes/<path>`  | Fetch one note, including its Markdown `content`.                           |
| `PUT`    | `/api/notes/<path>`  | Update that note. Does not create a missing note.                           |
| `DELETE` | `/api/notes/<path>`  | Soft-delete that note. The file leaves the garden and is kept in the trash. |
| `POST`   | `/api/notes/move`    | Rename a note. The old public URL redirects to the new one.                 |
| `POST`   | `/api/notes/restore` | Put a trashed note back at its path.                                        |

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

`DELETE` and `POST /api/notes/restore` take `revision` the same way `PUT` does.
Omit it only when you mean "act on whatever is there now". `POST /api/notes/move`
does too: the revision is the note you are moving, not the destination.

The list has two arrays. `notes` is the garden. `deleted` is the trash: the
same summary fields, plus `deletedAt`. A sync client that only reads `notes`
keeps working. Trashed notes are not in Studio, not in search, and not in the
public garden. They stay in Redis (the nightly restic snapshot of the store
includes them). `notes:export` does not write them into git; they are not part
of the note tree.

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
  ],
  "deleted": []
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

Move:

```bash
curl -s -X POST https://oddava.me/api/notes/move \
  -H "Authorization: Bearer $NOTES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from":"diary/hello.md","to":"reading/hello.md","revision":"r6f1c0a"}'
```

`200` returns the note at `to`, and `from` is the path that now redirects.
The public page `https://oddava.me/notes/diary/hello` answers `301` to
`/notes/reading/hello`. A second rename, `reading/hello` to `reading/goodbye`,
points both old URLs straight at `/notes/reading/goodbye`. The server follows
a chain that was stored as hops, too, and still answers with one redirect to
the note that exists now.

The destination must not already be a note, and its file name must not be used
anywhere else in the garden (`409` `path_exists` or `slug_exists`). It must
not be a trashed note either (`409` `deleted`): restore that note or pick
another path. Moving onto a path that only redirects replaces that redirect,
because the path is a note again. Creating does not do that. `POST /api/notes`
at a path that redirects returns `409` `moved`, so a retry cannot accidentally
erase the redirect.

`GET` or `PUT` of a path that only redirects returns `409` `moved` with
`location` set to the note's current path. It does not return `404`. A `404`
is how a client learns that it should create the note, and creating it would
publish a second copy at the old URL.

The Notes root (`index.md`) cannot be moved. A folder page (`reading.md` next
to notes inside `reading/`) can: only that one file moves. The notes inside
the folder stay where they are.

Delete:

```bash
curl -s -X DELETE https://oddava.me/api/notes/reading/hello.md \
  -H "Authorization: Bearer $NOTES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"revision":"r6f1c0a"}'
```

`200` returns the trashed summary (`path`, `title`, `updated`, `revision`,
`deletedAt`). The body is not in that response. `GET` of the same path returns
`410` with `code: "gone"` and the Markdown in `note.content`, so you can read
the trash without restoring it. The public page at the old URL is also `410`,
with a short "this note was removed" page rather than the site's generic 404.
A `404` would look like a typo. `410` says the link was real and the note was
taken down. `Cache-Control: no-store` is set on that page and on the `301`, so
a restore or a later rename is not stuck behind a cached redirect.

An old path that redirects to a note you then delete is `410` as well. Restore
puts the note back, and those old paths redirect to it again.

Deleting the Notes root is `400` `root_entry`. Deleting a folder page while
the folder still has notes is `409` `folder_not_empty`: move those notes out
first, the same rule Studio uses. An empty body is allowed on `DELETE`. That
means "delete whatever revision is current".

Restore:

```bash
curl -s -X POST https://oddava.me/api/notes/restore \
  -H "Authorization: Bearer $NOTES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"reading/hello.md","revision":"r7ab91e"}'
```

`200` returns the live note. The revision in the trash (`deleted[].revision`,
or the `revision` from the delete response) is the one to send. If that file
name was taken by another note while this one was in the trash, restore
returns `409` `slug_exists` and the trash entry stays.

A sync pass that will not clobber Studio:

1. `GET /api/notes` and compare each `revision` with the one you stored last time. `deleted` is the trash, separate from `notes`.
2. `GET` any note whose revision changed, and merge it locally.
3. `PUT` local edits with the revision you last fetched.
4. On `409` `revision_conflict`, fetch again and merge. Do not retry the same revision in a loop.
5. `POST` notes that do not exist on the server yet. On `409` `path_exists`, the server already has that path; fetch it instead of creating it again.
6. A rename is `POST /api/notes/move`, not a create at the new path. Remember the new revision and the new path. `409` `moved` means follow `location`.
7. A delete is `DELETE`, not something the next pull should recreate. `410` `gone` and `409` `deleted` both mean the note is in the trash. `POST /api/notes/restore` brings it back.

## Errors

| Status | `code`                      | When                                                                            |
| ------ | --------------------------- | ------------------------------------------------------------------------------- |
| `400`  | `invalid_path`              | Path is missing or not a kebab-case `.md` note.                                 |
| `400`  | `invalid_content`           | `content` is missing or not a string.                                           |
| `400`  | `invalid_revision`          | `revision` is present and not a string.                                         |
| `400`  | `invalid_request`           | The body is not a JSON object, or a move's destination is the source path.      |
| `400`  | `root_entry`                | Move, delete, or restore of the Notes root (`index.md`).                        |
| `400`  | `validation_failed`         | Frontmatter does not match the note schema. `issues` lists the fields.          |
| `401`  | `unauthorized`              | Missing or wrong bearer token.                                                  |
| `404`  | `not_found`                 | No live note, no redirect, and nothing in the trash at that path.               |
| `405`  | `method_not_allowed`        | A method this URL does not implement. `Allow` lists the ones it does.           |
| `409`  | `path_exists`               | Create, move, or restore, but that path is already a live note.                 |
| `409`  | `slug_exists`               | That file name is used at another path.                                         |
| `409`  | `revision_conflict`         | `revision` does not match. `note.revision` is the current one.                  |
| `409`  | `moved`                     | That path redirects to `location`. Do not create a new note there.              |
| `409`  | `deleted`                   | A trashed note still holds that path. Restore it, or choose another path.       |
| `409`  | `folder_not_empty`          | That folder page still has notes inside the folder.                             |
| `410`  | `gone`                      | The note is in the trash. `note` includes `deletedAt` and, on `GET`, `content`. |
| `413`  | `payload_too_large`         | Body is over 1 MB.                                                              |
| `429`  | `rate_limited`              | More than 120 requests in a minute.                                             |
| `503`  | `notes_api_disabled`        | `NOTES_API_TOKEN` is not set.                                                   |
| `503`  | `content_store_unavailable` | Redis is not configured or could not be reached.                                |
| `503`  | `content_busy`              | Another save holds the content lock. `Retry-After: 1`.                          |
| `503`  | `rate_limit_unavailable`    | Rate limiting could not run (usually the signing secret or Redis).              |
