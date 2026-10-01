# Security Policy

## Supported versions

The latest `main` branch receives fixes. Tagged releases carry the fixes from that
point onward.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
**Report a vulnerability** option under the *Security* tab of this repository, or
contact the maintainer directly via their GitHub profile.

Include what you can of: the commit you tested, the exact command, and the impact.
Reports are answered within a few days.

## Scope notes

- This tool **reads** public pricing APIs and writes only to its own cache directory.
  It does not hold cloud credentials beyond an optional Google Cloud API key used
  for the public Cloud Billing Catalog API.
- Pricing data comes from provider APIs and is cached on disk for 24h under
  `~/.cache/saudi-cloud-costs`. Treat cached files as untrusted input only if you
  share your user account with others.
