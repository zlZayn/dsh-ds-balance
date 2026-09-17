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
> **The balance is read from the official `GET /user/balance`** — not estimated. The credential is resolved only through DSH's credential channel: the API key never lands in a settings file and is never returned to the UI.

The balance needs somewhere to live that does not take up room. A permanent status ring at the bottom of the sidebar; click it for the three amounts and the freshness of the data. Anything you want to configure lives on the settings card.

<p align="center">
  <img src="assets/sidebar-popover_en.png" alt="The DeepSeek balance entry at the bottom of the sidebar, with its popover open" width="360">
  <br>
  <em>A permanent fixture at the <strong>bottom of the sidebar</strong>, alongside Usage statistics and Settings; click it for the balance, the granted / topped-up split, and how fresh the data is.</em>
</p>

## Surface at a glance

| Surface | One line | Use it for |
|---|---|---|
| Sidebar ring | A status ring plus label at the bottom of the sidebar; **how full it is = how far the balance is from that currency's warning line** | Seeing at a glance how much is left and how close it is to the warning line |
| Balance popover | Click the entry: total, granted / topped-up split, data freshness, manual refresh (with cooldown) | Checking the exact figures, and how many minutes old they are |
| Settings card | Connection / Display / Thresholds / Refresh, each collapsible, all collapsed by default | Changing the endpoint, the currency, the warning lines, the cadence |

The division of labour is fixed: **the ring answers "roughly how much is left", the popover answers "exactly how much", and the card answers "how is that computed".**

<p align="center">
  <img src="assets/settings-card_en.png" alt="The DeepSeek balance card in the plugin settings" width="360">
  <br>
  <em>Sits alongside other plugins in <strong>Settings → Plugins → Plugin configuration</strong>; all four groups are collapsed by default, so the card opens as four header rows.</em>
</p>

## Capabilities

- A permanent status ring plus label at the bottom of the sidebar; click it for the breakdown. The collapsed and expanded states share the same ring, in the same place.
- The balance refreshes on its own schedule and the UI reads a cache — leaving the interface open does not hammer the upstream.
- The popover shows the total, the granted / topped-up split, how old the data is, and a manual refresh with a cooldown.
- Multiple currencies: the account decides which currency is shown; when the one chosen in settings is absent, the popover explains and offers a one-click switch.
- The settings card has four collapsible groups, all collapsed by default; a group holding a bad value opens itself.
- The credential is inherited from the official model settings by default, so there is nothing to re-enter; where it comes from is on a badge
  (provided by launch environment / configured / not configured / overridden), and a read-only field explains itself instead of offering an edit.
- Colour carries state only (normal / low / critical), never an amount; see "[Reading the ring](#reading-the-ring)".

## Installation

### Requirements

- **DSH**: the range is whatever [package.json](package.json) declares under `engines.dsh` and `peerDependencies`; this plugin follows the alpha line the host is on.
- Node `>= 20` (same source of truth: `engines.node`).

Install the host by **naming the version line explicitly**: the `latest` tag of `@deepseek-ai/dsh` is older than the line this plugin requires — a default install lands outside the declared range.

```bash
npm install -g @deepseek-ai/dsh@alpha     # the line this plugin promises to support
```

Compatibility is measured, not inferred: every week [compat.yml](.github/workflows/compat.yml) swaps packages onto the `alpha` and `next` lines and reruns the existing tests. The current verdict, and what to do when it goes red, are in [docs/PUBLISHING.md](docs/PUBLISHING.md) under "Compatibility".

### From npm

```bash
dsh plugin --profile web add dsh-ds-balance
```

**Restarting `dsh --profile web`** is what makes it take effect.

### From source

```bash
git clone https://github.com/zlZayn/dsh-ds-balance.git
cd dsh-ds-balance
npm install && npm run build

dsh plugin --profile web add "$PWD"
```

Same as the npm route: it takes effect after a restart.

### Discovery

- **npm**: [`dsh-ds-balance`](https://www.npmjs.com/package/dsh-ds-balance)
- **GitHub**: [`zlZayn/dsh-ds-balance`](https://github.com/zlZayn/dsh-ds-balance)

The repository carries the GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin), which is how the plugin marketplace discovers plugins.

## Configuration

Open **Settings → Plugins → Plugin configuration → DeepSeek balance**. Four groups, each collapsible:

- **Connection**: the API base URL and the credential, inherited from the official model page by default and kept inside the nested "Customised settings".
- **Display**: which currency to use for amounts, or let it follow the account.
- **Thresholds**: two alert lines per currency (warning / critical). **Within one currency the critical line must be strictly lower than the warning line** — equality is rejected too.
- **Refresh**: the server refresh interval and the UI poll interval.

Saving applies immediately; there is no need to restart DSH.

### Reading the ring

- How full the ring is = the current balance as a fraction of that currency's **warning line**, capped at 100%; the critical line takes no part in drawing it — it already decided the colour.
- Colour carries state only, never an amount: normal, low and critical each get one hue; an account that cannot be read gets a ring with a cross instead.
- A currency with no threshold configured falls back to state: full ring for normal and unavailable, 3/4 for low, 1/4 for critical, empty for unknown.
- Why colour is never computed from an amount, and why thresholds are only a scale → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), under "Data flow".

### Credentials

The key is resolved only through DSH's credential channel; the card's "API key" inherits the one already configured on the official model settings page.
When it comes from the launch environment (an environment variable) the field is read-only and the badge says where it came from.

## Security and boundaries

- **The API key is never returned to the UI**: the config endpoint returns only a fixed-length mask, not even the last few characters.
- The key is never logged and never written to a file owned by this plugin; the settings file holds only a reference name, so the card is safe to screenshot or share.
- Balance snapshots live in DSH's own data directory, grouped by a ledger identifier derived from the credential — changing the key opens a new ledger and old snapshots are never mixed in.
- That identifier also involves a `.salt` file in DSH's home directory; **lose it and old snapshots become unreadable**.
- Only `api.deepseek.com` is contacted; nothing is proxied or forwarded.

## License

[MIT](LICENSE).

## Contributing

Where to report bugs, what to check before proposing a feature, and what to do before sending a PR → [CONTRIBUTING_en.md](CONTRIBUTING_en.md).

Design stance and implementation constraints → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the release flow and the version-bump decision chain → [docs/PUBLISHING.md](docs/PUBLISHING.md); the maintainer's document map → [AGENTS.md](AGENTS.md).
