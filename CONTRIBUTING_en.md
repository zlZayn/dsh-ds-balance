# Contributing

[中文](CONTRIBUTING.md)

Three kinds of contribution, each with its own prerequisite.

## When reporting a bug

- The DSH host version: the output of `dsh --version`.
- The version of this plugin: the `version` in `package.json`, and which commit the build came from.
- Symptom and minimal reproduction: where it first goes wrong, what you expected, what you got.
- A **redacted** log excerpt. This plugin's own logs carry no credentials, but host logs may
  contain output from other plugins — read before you paste.
- Screenshots or a recording for anything visual.

**Never paste an API key.** A key that appears in an issue is treated as leaked;
revoke and reissue it in the console first.
This plugin reads credentials only through DSH's credential channel, so any bug that needs you
to paste a key in order to reproduce it means we designed something wrong.

## Before proposing a feature

Open an issue describing the problem first; do not send a PR straight away.

- This plugin does exactly two things: **show the balance** and **configure that display**.
  History charts, alerting, and multi-account aggregation are out of scope and need their
  ownership discussed first.
- The UI must use the native slots and the `--dsw-*` semantic tokens.
  PRs that pull in a component library, Tailwind, or literal colour values will not be merged.
- Colour comes only from the `severity` the host returns. Any design that colours something
  in the frontend based on an amount threshold is rejected.
- A new configuration field means changing the host schema, `CONFIG_FIELDS`, both locale
  dictionaries, and the root readme — the full list and sync points are in
  [src/client/settings/README.md](src/client/settings/README.md).

## Before sending a PR

- Run `npm run typecheck` and `npm test`; both must be green.
- If you touched documentation, run the link check — the command is in the "常用命令"
  section of [AGENTS.md](AGENTS.md).
- Write the commit message as "what / why / how it was verified / how to roll back";
  one logical change per commit.
- If you changed what the settings card renders, re-shoot the screenshots in the same batch,
  or explain in the commit message why you did not — the criteria are in
  [assets/AGENTS.md](assets/AGENTS.md).
- Contract changes (externally visible behaviour, interface signatures, configuration keys,
  output format) must update [README.md](README.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) in the same change.

The full list of design constraints is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
getting started is in [README.md](README.md).
