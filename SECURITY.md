# Security Policy

## Supported Versions

Only the latest commit on `main` is considered supported for security fixes.

## Reporting a Vulnerability

Do not open a public GitHub issue for a security vulnerability.

Report vulnerabilities privately to the MedQuel repository maintainers through GitHub's private vulnerability reporting flow. Include:

- A clear description of the issue
- The affected function and file or endpoint
- Reproduction steps or a proof of concept
- Potential impact
- Any suggested mitigation

Please do not include real user data, credentials, service-account keys, API keys, or production payloads in the report.

## Secret Exposure

If a credential is committed or exposed, revoke and rotate it immediately, then report the incident privately. Removing a secret from the latest commit is not sufficient because Git history may retain it.
