# Security

## Sensitive-data rule

Do not commit:

- credentials, tokens, cookies, OAuth device-flow files, or `.env` files
- live finance workbooks, PDFs, CSV exports, or generated dashboard data
- email vault contents or extracted attachment text
- MYOB/API responses containing operational finance data
- personal staffing/payroll data

## Development rule

Use synthetic or redacted sample data for tests and examples. Generated dashboard outputs should stay local unless Kyle explicitly approves a specific export.

## GitHub settings recommended

- Private repository
- Require pull request before merge
- Require at least 1 approval
- Enable secret scanning / push protection where available
- Limit collaborators to named people who need access

## If a secret is accidentally committed

1. Treat it as compromised.
2. Revoke/rotate it at the source.
3. Remove it from Git history before continuing.
4. Do not rely on deleting the file in a later commit.
