# ds-balance

Show the DeepSeek account balance at the bottom of the DSH sidebar, with a configuration card in settings.

## Capabilities

- A permanent status ring plus label at the bottom of the sidebar; click it to open a popover with the balance breakdown. The collapsed and expanded states share the same ring.
- Reads the real DeepSeek balance (`GET /user/balance`); the server refreshes on `serverRefreshSeconds` and the browser reads the cache on `clientPollSeconds` without hitting the upstream.
- Popover: total balance, granted / topped-up split, data freshness, and a manual refresh with cooldown.
- Multiple currencies: the **server** picks which currency to show; when the currency chosen in settings is absent from the account, the popover says so and offers a one-click switch.
- The settings card has four collapsible groups — Connection / Display / Thresholds / Refresh — all collapsed by default; a group with an invalid draft is forced open.
- Credential fields carry a "configured / not configured / overridden" badge; the credential is inherited from the official model settings by default, so there is nothing to re-enter.
- Colour comes only from the `severity` the server returns; threshold policy is not in the frontend.

## Quick start

```bash
npm install
npm run build
dsh plugin --profile <profile> add .
```

After installing, add the plugin row to that profile's `cordis.patch.yml` (full steps and rollback are in
[AGENTS.md](AGENTS.md), section "常用命令").

**Changing the host half requires restarting DSH**; the browser half is hot-swapped by the client.

## Where the data comes from and goes

- Endpoints are registered by the host half under `/api/v1/*` via `ctx.connection.fetch`; the physical carrier already applies trust and browser authentication.
- **The API key is never returned to the frontend**: the config endpoint returns only a fixed-length mask, not even the last few characters.
- The key is resolved only through the DSH credential channel; it is never logged and never written to a file owned by this plugin.
- Balance snapshots land in DSH's own storage (`ctx.storageDomain`), grouped by a ledger identifier derived from the credential. Changing the key opens a new ledger; old snapshots are never mixed in.
- One non-record file, `.salt`, lives under `$DSH_HOME` and derives the ledger identifier. **Losing it makes old snapshots unreadable.**

## Boundary between UI and backend

- Colour is decided only by the server's `severity`; the frontend does no amount comparison at all.
- Amounts are always eight-decimal strings; the frontend trims them to two characters-wise and never goes through floating point.
- Full response shape and configuration contract → [docs/ui-handoff.md](docs/ui-handoff.md).

## License

MIT, see [LICENSE](LICENSE).
