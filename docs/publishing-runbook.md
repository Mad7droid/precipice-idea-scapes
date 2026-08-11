# Publishing runbook

Publishing is an invite-only beta. Public links are intentionally unlisted, not access
controlled; do not use a link for confidential material. Comments, reporting, and moderation
are deliberately not part of this release.

Run preview first with separate D1, R2, OAuth, and Turnstile resources. Do not deploy the
production Worker until its metrics and alerting are visible.

## Configuration

| Item | Production value |
| --- | --- |
| Worker config | ignored `wrangler.publish.toml` (copy the committed example) |
| App origin | `https://precipice.pages.dev` |
| Database migrations | `worker/publish/migrations` |
| Retained slots | 50 per account, published or unpublished |
| Current snapshot storage | 100 MiB per account |
| Create/update budget | 20 per account per UTC day |

Apply both migrations before deploying code that requires them:

```sh
cp wrangler.publish.example.toml wrangler.publish.toml
# Fill in the real Worker/D1/R2 identifiers and namespace IDs locally; never commit this file.
pnpm wrangler d1 migrations apply precipice-publications --local --config wrangler.publish.toml
pnpm wrangler d1 migrations apply precipice-publications --remote --config wrangler.publish.toml
```

Existing user rows are automatically active members through migration defaults. Existing
publication byte counts are filled from the current R2 object by the hourly cron in batches of
50, and immediately for an account before its next create/update. Verify there are no remaining
legacy rows before promotion:

```sh
pnpm wrangler d1 execute precipice-publications --remote --config wrangler.publish.toml \
  --command "SELECT COUNT(*) AS unmeasured FROM publications WHERE status != 'deleted' AND current_bytes = 0"
```

## OAuth and Turnstile

Create a Google **Web application** OAuth client with one redirect URI:

```
https://precipice-publications.<your-subdomain>.workers.dev/auth/callback
```

Create a Cloudflare Turnstile managed widget for the exact Pages hostname. Its action is
`publish-auth`. Put the site key in the Pages build environment and the secret only in Worker
secrets:

```sh
pnpm wrangler secret put GOOGLE_CLIENT_ID --config wrangler.publish.toml
pnpm wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.publish.toml
pnpm wrangler secret put TURNSTILE_SECRET --config wrangler.publish.toml
pnpm wrangler secret put BOOTSTRAP_ADMIN_EMAILS --config wrangler.publish.toml
```

Set `VITE_TURNSTILE_SITE_KEY` and `VITE_PUBLICATION_API_URL` in the Pages build environment.
Never commit any of these secret values. The Worker validates Turnstile server-side, its action,
and the expected `APP_ORIGIN` hostname before it creates OAuth state; the widget alone is not a
security control.

For a direct Wrangler Pages deployment, pass the two public build values explicitly rather than
relying on a developer's local shell configuration:

```sh
VITE_PUBLICATION_API_URL=https://precipice-publications.precipice.workers.dev \
VITE_TURNSTILE_SITE_KEY=<Turnstile-site-key> \
pnpm build
pnpm wrangler pages deploy dist --project-name precipice --branch main
```

The site key is intended to be public. `TURNSTILE_SECRET`, OAuth secrets, bootstrap addresses,
and Cloudflare tokens are not; never put those in `.env.example`, the Pages bundle, or a commit.

The Pages build injects `VITE_PUBLICATION_API_URL` into the generated `_headers` CSP. The source
uses a placeholder, so the production Worker hostname is not committed to GitHub; a build without
the variable deliberately uses a non-routable CSP origin.

Deploy the Worker only after these values and the four rate-limit bindings in
`wrangler.publish.toml` are configured:

```sh
pnpm wrangler deploy --config wrangler.publish.toml
```

Apply the remote migration before that Worker deploy. Verify the Worker secret list includes
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `TURNSTILE_SECRET` first:

```sh
pnpm wrangler secret list --config wrangler.publish.toml
pnpm wrangler d1 migrations apply precipice-publications --remote --config wrangler.publish.toml
```

The bindings are deliberately separate: OAuth 10/minute/IP, public reads 120/minute/IP,
mutations 30/minute/IP, and mutations 10/minute/authenticated user. Do not reuse their namespace
IDs in another Worker unless shared counters are intentional.

## Bootstrap and invitations

1. Put the first administrator's verified Google email in `BOOTSTRAP_ADMIN_EMAILS`.
2. Complete that account's sign-in once. Confirm the row has `role = 'admin'` in D1.
3. Remove `BOOTSTRAP_ADMIN_EMAILS` immediately:

   ```sh
   pnpm wrangler secret delete BOOTSTRAP_ADMIN_EMAILS --config wrangler.publish.toml
   ```

4. The administrator opens **Publish → Publishing administration** in the editor and creates
   invitations. There is no email sender in v1; share the instructions manually.

Only a pending, case-normalized email invitation can create a new member account. Existing active
accounts remain able to sign in. The invite claim and account creation are one D1 transaction;
one invitation cannot create two users. Admin actions are written to `admin_audit` and retained
for 90 days.

To recover admin access, use an existing admin to grant access first. If none remain, temporarily
set `BOOTSTRAP_ADMIN_EMAILS` for a verified owner email, deploy, sign in, verify the role, and
delete the secret again. Record the recovery in the operational log.

Suspension takes effect on the next authenticated request, including session exchange, listing,
and mutations. Restore only after reviewing the relevant audit row and public links.

## Operations and emergency response

- Unpublishing keeps the retained slot and its URL; it does **not** release storage capacity.
  Deleting a publication removes its R2 prefix and frees the slot.
- Same-hash updates are no-ops and do not consume a daily write credit. Superseded versions are
  retained seven days, so the 20-write budget bounds worst-case per-account R2 exposure to about
  380 MiB.
- The hourly cron clears expired OAuth states, exchange codes, sessions, stale daily usage, due
  superseded snapshots, and audit rows older than 90 days.
- Monitor Turnstile failures, 429s split by binding, invite denials, daily-write/storage denials,
  D1 table growth, and R2 stored bytes. Alert on a sustained increase rather than a single user
  error.

To immediately disable every public link without deleting data:

```sh
pnpm wrangler d1 execute precipice-publications --remote --config wrangler.publish.toml \
  --command "UPDATE publications SET status = 'unpublished' WHERE status = 'published'"
```

To take down one abusive publication and free its slot, delete its R2 prefix and then mark its
row `deleted`; use the account owner or a controlled D1 operation, and preserve the audit trail.
If abuse is active, remove the Worker route or deploy an emergency Worker that returns 503 for
public reads while investigation is underway.

## Preview acceptance checklist

Seed one bootstrap admin and two invitees. Verify: no-invite denial, valid invited sign-in,
single-use invitation, suspension/restore, all admin authorization failures, Turnstile rejection,
slot/storage/daily-write denials, same-hash no-op, delete cleanup, and cron cleanup. Then check
the production dashboard has the metrics above before promoting.

After deployment, confirm a published `/p/<id>` page draws its relationship arrows as well as
its cards. The viewer has invisible non-interactive source/target anchors specifically so React
Flow can measure those endpoints; removing them makes React Flow omit every edge.
