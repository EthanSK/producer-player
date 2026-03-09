# Security policy

## Supported versions

Producer Player is still early-stage.
Security fixes should be assumed to land on the latest code on `main` first.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| older snapshots / ad-hoc builds | No guarantee |

## Reporting a vulnerability

If you find a security issue, please **do not open a public GitHub issue with exploit details**.

Instead:

1. Open a GitHub Security Advisory / private vulnerability report if available for the repo.
2. If that is not available, contact the maintainer privately and include:
   - what you found
   - how it can be reproduced
   - affected files or components
   - the impact you believe it has
   - whether the issue is already public

Please avoid sharing proof-of-concept details publicly until there has been a reasonable chance to investigate and patch the issue.

## Scope notes

Current repo hygiene includes:

- Dependabot for npm and GitHub Actions updates
- CodeQL analysis in GitHub Actions
- reduced public-facing internal process material in the README and landing page

## Important release note

Unsigned test builds may exist before signing and notarization are configured.
Those builds are useful for testing, but they should not be described as a fully trusted polished public macOS release.
