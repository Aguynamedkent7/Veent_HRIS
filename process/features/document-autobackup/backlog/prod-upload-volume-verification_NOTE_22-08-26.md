---
name: note:prod-upload-volume-verification
description: "OPEN — docker-compose.yml now mounts uploads and backups as named volumes (#164 §15), but no environment exists to prove the mounts survive a redeploy"
date: 22-08-26
feature: document-autobackup
---

# Known gap — the uploads/backups volume mounts are unproven (#164 §15)

**Status: OPEN.** The fix is committed; the verification is impossible here.

## The defect that was fixed

Before #164, `docker-compose.yml` defined exactly one volume, `pgdata`. There was **no**
volume for `UPLOAD_DIR`, and `.env.prod.example` did not set `UPLOAD_DIR` at all — so in a
production deployment every 201 file was written to `/app/uploads` **inside the container**,
and `docker compose pull && docker compose up -d` (the documented deploy) destroyed them.

This is guaranteed data loss, and it is not tangential to the backup feature: the backup
script runs via `docker compose run --rm app`, whose container filesystem is discarded on
exit. Without the mounts, the feature would have faithfully copied every document into a
directory deleted seconds later.

## What was verified

`docker compose config` parses and resolves both mounts:

```
uploads -> /app/uploads   (named volume veent_hris_uploads)
backups -> /app/backups   (named volume veent_hris_backups)
```

## What is NOT verified

- That the volumes are actually created on the droplet.
- That they are writable by the container user.
- That they survive `docker compose pull && docker compose up -d`.
- That existing container-local files are migrated (there are none to migrate today —
  but if a deploy has already happened, whatever is in the container layer is already lost).

There is no prod or staging environment, so none of this can be exercised.

## How to close it

On the first real deploy: `docker compose up -d`, upload one document through the UI,
`docker compose pull && docker compose up -d`, then confirm the document still downloads.

## Related concern (do not lose)

`pgdata`, `uploads` and `backups` are all named volumes on ONE droplet filesystem. An
unpruned backup tree can therefore fill the disk Postgres writes to. The script warns
(`WARNING: BACKUP_DIR shares a filesystem with UPLOAD_DIR`) but cannot refuse — on a
single-volume box there is no other option. Keep `retentionCount` low until backups live on
separate storage.
