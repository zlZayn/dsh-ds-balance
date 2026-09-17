<p align="center">
  <h1 align="center">dsh-ds-balance</h1>
</p>

<div align="center">
  <p><strong>DeepSeek account balance in the DSH sidebar</strong></p>
  <p><em>把 DeepSeek 账户余额放进 DSH 的左边栏</em></p>

  <p>
    <a href="https://api-docs.deepseek.com/"><img src="https://img.shields.io/badge/DeepSeek%20API-Official-4D6BFE?style=flat" alt="DeepSeek official API"></a>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4176E6?style=flat" alt="DeepSeek Harness Plugin"></a>
  </p>

  <p>
    <a href="https://github.com/zlZayn/dsh-ds-balance/actions/workflows/ci.yml"><img src="https://github.com/zlZayn/dsh-ds-balance/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/dsh-ds-balance"><img src="https://img.shields.io/npm/v/dsh-ds-balance.svg" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  </p>

  <p>
    <a href="README.md">简体中文</a> · <strong><a href="README_en.md">English</a></strong>
  </p>
</div>

---

> [!NOTE]
> **The balance is read from the official `GET /user/balance`** — not estimated, and not someone else's cache.
> Amounts stay eight-decimal strings end to end and never pass through floating point; colour comes
> **only from the `severity` the server returns**, and the frontend does no amount comparison of its own.

The balance needs somewhere to live that does not take up room. A permanent status ring at the bottom of the
sidebar; click it for the three amounts and the freshness of the data. Anything finer, or anything you want to
configure, lives on the settings card.

<p align="center">
  <img src="assets/sidebar-popover_en.png" alt="The DeepSeek balance entry at the bottom of the sidebar, with its popover open" width="460">
  <br>
  <em>A permanent fixture at the <strong>bottom of the sidebar</strong>, alongside Usage statistics and Settings; click it for the balance, the granted / topped-up split, and how fresh the data is.</em>
</p>

## Surface at a glance

| Surface | One line | Use it for |
|---|---|---|
| Sidebar ring | A status ring plus label at the bottom of the sidebar; **its arc is the balance as a fraction of that currency's warning line** | Seeing at a glance how much is left and how close it is to the warning line |
| Balance popover | Click the entry: total, granted / topped-up split, data freshness, manual refresh (with cooldown) | Checking the exact figures, and how many minutes old they are |
| Settings card | Connection / Display / Thresholds / Refresh, each collapsible, all collapsed by default | Changing the endpoint, the currency, the warning lines, the cadence |

The division of labour is fixed: **the ring answers "roughly how much is left", the popover answers "exactly how much",
and the card answers "how is that computed".**

<p align="center">
  <img src="assets/settings-card_en.png" alt="The DeepSeek balance card in the plugin settings" width="460">
  <br>
  <em>Sits alongside other plugins in <strong>Settings → Plugins → Plugin configuration</strong>; all four groups are collapsed by default, so the card opens as four header rows.</em>
</p>

## Capabilities

- A permanent status ring plus label at the bottom of the sidebar; click it to open a popover with the balance breakdown. The collapsed and expanded states share the same ring.
- Reads the real DeepSeek balance (`GET /user/balance`); the server refreshes on `serverRefreshSeconds` and the browser reads the cache on `clientPollSeconds` without hitting the upstream.
- Popover: total balance, granted / topped-up split, data freshness, and a manual refresh with cooldown.
- Multiple currencies: the **server** picks which currency to show; when the currency chosen in settings is absent from the account, the popover says so and offers a one-click switch.
- The settings card has four collapsible groups — Connection / Display / Thresholds / Refresh — all collapsed by default; a group with an invalid draft is forced open.
- Credential fields carry a "provided by launch environment / configured / not configured / overridden" badge; a read-only field stays empty and lets the badge and the line under it explain why. The credential is inherited from the official model settings by default, so there is nothing to re-enter.
- Colour comes only from the `severity` the server returns; thresholds only scale the ring arc and never affect colour.

## Installation

### Requirements

- **DSH `^0.1.6-alpha.1`** — the range declared in [package.json](package.json) under `engines.dsh` and `peerDependencies`.
- Node `>= 20`

Install the host by **naming the version line explicitly**: the `latest` tag of `@deepseek-ai/dsh` points at `0.1.5-rc.1`, one notch *below* what this plugin requires — a default install lands outside the declared range.

```bash
npm install -g @deepseek-ai/dsh@alpha     # the line this plugin promises to support
```

Compatibility is measured, not inferred: every week [compat.yml](.github/workflows/compat.yml) swaps packages onto the `alpha` and `next` lines and reruns the existing tests. The current verdict, and what to do when it goes red, are in [docs/PUBLISHING.md](docs/PUBLISHING.md) under "Compatibility".

### From npm

```bash
dsh plugin --profile web add dsh-ds-balance
```

The package declares `dsh.bundle.patch`, so `dsh plugin` installs it as a profile layer and records it in `dsh.profile.bundles`. **It takes effect after restarting `dsh --profile web`.**

### From source

```bash
git clone https://github.com/zlZayn/dsh-ds-balance.git
cd dsh-ds-balance
npm install && npm run build

dsh plugin --profile web add "$PWD"
```

Same bundle-layer route as npm, same restart to take effect. Changes to the host half require that restart — the browser half is hot-swapped by `dsh-client-hmr`.

### Discovery

- **npm**: [`dsh-ds-balance`](https://www.npmjs.com/package/dsh-ds-balance)
- **GitHub**: [`zlZayn/dsh-ds-balance`](https://github.com/zlZayn/dsh-ds-balance)

The repository carries the GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin), which is how the plugin marketplace discovers plugins.

## Configuration

Open **Settings → Plugins → Plugin configuration → DeepSeek balance**. Four groups, each collapsible:

- **Connection**: the read-only credential state, an editable API base URL, and the apiKey / apiKeyRef kept inside the nested "Customised settings".
- **Display**: which currency to use for amounts, or let it follow the account.
- **Thresholds**: two alert lines per currency (warning / critical). They are **stored, never evaluated** — the frontend does not colour anything from them; colour still comes from the server's `severity`. The only place that reads them is the ring arc.
- **Refresh**: the server refresh interval and the browser poll interval.

### Two hard rules about thresholds

- **Within one currency the critical line must be strictly lower than the warning line.** Equality is rejected too: at that point a balance sitting exactly on the line would be classified into both bands, and "warning" would stop meaning anything. The host validates before writing (the error names the currency); the frontend hints after blur and disables Save. Saving applies it immediately.
- **The ring arc is the balance as a fraction of the warning line**, capped at 100%. The critical line does not take part — it already decided the colour on the server. When no threshold is configured, the arc falls back to the `severity`: green / grey full ring, amber 3/4, red 1/4, unknown empty.

### Credentials

The key is resolved only through DSH's credential channel; the card's "API key" inherits the one already configured on the official model settings page.
When it comes from the launch environment (an environment variable) the field is read-only and the badge reads "Provided by launch environment".

## Security and boundaries

- Endpoints are registered by the host half under `/api/v1/*` via `ctx.connection.fetch`; the physical carrier already applies trust and browser authentication.
- **The API key is never returned to the frontend**: the config endpoint returns only a fixed-length mask, not even the last few characters.
- The key is never logged and never written to a file owned by this plugin.
- Balance snapshots land in DSH's own storage (`ctx.storageDomain`), grouped by a ledger identifier derived from the credential. Changing the key opens a new ledger; old snapshots are never mixed in.
- One non-record file, `.salt`, lives under `$DSH_HOME` and derives the ledger identifier. **Losing it makes old snapshots unreadable.**
- Only `api.deepseek.com` is contacted; nothing is proxied or forwarded. The full response shape is in [docs/ui-handoff.md](docs/ui-handoff.md).

## License

[MIT](LICENSE).

## Contributing

Where to report bugs, what to check before proposing a feature, and what to do before sending a PR → [CONTRIBUTING_en.md](CONTRIBUTING_en.md).

Design stance: **colour comes only from the server's `severity`; the frontend makes no amount judgements**, and the UI uses only the native slots and the `--dsw-*` semantic tokens.
The writing conventions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The maintainer's document map is [AGENTS.md](AGENTS.md); the release flow and version-bump decision chain are in [docs/PUBLISHING.md](docs/PUBLISHING.md).
