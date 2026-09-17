# ds-balance

[中文](README.md)

[![ci](https://github.com/zlZayn/dsh-ds-balance/actions/workflows/ci.yml/badge.svg?branch=main)](.github/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FzlZayn%2Fdsh-ds-balance%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&color=brightgreen)](package.json)
[![dsh](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FzlZayn%2Fdsh-ds-balance%2Fmain%2Fpackage.json&query=%24.engines.dsh&label=dsh&color=blueviolet)](package.json)

> **NOTE**
> This package is not published yet (`private: true`); it installs from source only.
> The release flow and the version-bump decision chain are in
> [docs/PUBLISHING.md](docs/PUBLISHING.md).

Shows the DeepSeek account balance at the bottom of the DSH sidebar, with a configuration card in settings.
The balance is read from the real `GET /user/balance`; colour comes only from the `severity` the server returns.

![settings card](assets/settings-card_en.png)

## Capabilities

- A permanent status ring plus label at the bottom of the sidebar; click it to open a popover with the balance breakdown. Its arc is the balance as a fraction of the `warn` threshold, and the collapsed and expanded states share the same ring.
- Reads the real DeepSeek balance (`GET /user/balance`); the server refreshes on `serverRefreshSeconds` and the browser reads the cache on `clientPollSeconds` without hitting the upstream.
- Popover: total balance, granted / topped-up split, data freshness, and a manual refresh with cooldown.
- Multiple currencies: the **server** picks which currency to show; when the currency chosen in settings is absent from the account, the popover says so and offers a one-click switch.
- The settings card has four collapsible groups — Connection / Display / Thresholds / Refresh — all collapsed by default; a group with an invalid draft is forced open.
- Credential fields carry a "provided by launch environment / configured / not configured / overridden" badge; a read-only field stays empty and lets the badge and the line under it explain why. The credential is inherited from the official model settings by default, so there is nothing to re-enter.
- Colour comes only from the `severity` the server returns; thresholds only scale the ring arc and never affect colour.

## Installation

Prerequisites: DSH `^0.1.6-alpha.1`, Node `>=20`.

Installing from npm is not open yet (the package is unpublished). From source:

```bash
git clone https://github.com/zlZayn/dsh-ds-balance.git
cd dsh-ds-balance
npm install
npm run build
dsh plugin --profile <profile> add .
```

After installing, add the plugin row to that profile's `cordis.patch.yml`; the full steps and rollback are in
[AGENTS.md](AGENTS.md), section "常用命令".

**Changing the host half requires restarting DSH**; the browser half is hot-swapped by the client.

Once installed it shows up in two places: a configuration card under Settings → Plugins → Plugin configuration,
and a status ring at the bottom of the sidebar.

## Configuration

The card has four groups, all collapsed by default:

- Connection: the read-only credential state, an editable API base URL, and the apiKey / apiKeyRef kept inside the nested "Customised settings".
- Display: which currency to use for amounts, or let it follow the account.
- Thresholds: the alert lines. They are **evaluated on the server** — the frontend only scales the ring arc by `warn`, and never colours anything from them.
- Refresh: the server refresh interval and the browser poll interval.

## Where the data comes from and goes

- Endpoints are registered by the host half under `/api/v1/*` via `ctx.connection.fetch`; the physical carrier already applies trust and browser authentication.
- **The API key is never returned to the frontend**: the config endpoint returns only a fixed-length mask, not even the last few characters.
- The key is resolved only through the DSH credential channel; it is never logged and never written to a file owned by this plugin.
- Balance snapshots land in DSH's own storage (`ctx.storageDomain`), grouped by a ledger identifier derived from the credential. Changing the key opens a new ledger; old snapshots are never mixed in.
- One non-record file, `.salt`, lives under `$DSH_HOME` and derives the ledger identifier. **Losing it makes old snapshots unreadable.**

## Boundary between UI and backend

- Colour is decided only by the server's `severity`. The frontend reads the `warn` threshold only to scale the ring arc, never to colour anything.
- Amounts are always eight-decimal strings; the frontend trims them to two characters-wise and never goes through floating point.
- Full response shape and configuration contract → [docs/ui-handoff.md](docs/ui-handoff.md).

## Contributing

Prerequisites for bug reports, feature proposals, and pull requests are in [CONTRIBUTING_en.md](CONTRIBUTING_en.md).

## License

MIT, see [LICENSE](LICENSE).
