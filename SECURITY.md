# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Spiralmem seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please email security issues to: [your-email@domain.com]

Please include the following information in your report:
- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

### What to Expect

After submitting a report, you can expect:
- Acknowledgment of your report within 48 hours
- Regular updates about our progress
- Credit for responsible disclosure (if desired)

## Security Considerations

### Local Processing
- All AI processing happens locally on your machine
- No data is transmitted to external services (except YouTube URLs for download)
- Your video content and transcripts remain on your device

### Configuration
- Store sensitive configuration (API keys) in `.env` files
- `.env` files are excluded from version control by default
- Never commit API keys or sensitive data to the repository

### Dependencies
- We regularly audit our dependencies for known vulnerabilities
- Automated security scanning is enabled for this repository
- Dependencies are kept up to date

### Data Storage
- Video transcripts are stored in local SQLite database
- No cloud storage or external database connections
- Database files are excluded from version control

## Best Practices for Users

1. **Keep Spiralmem Updated**: Always use the latest version
2. **Secure Your API Keys**: Never share YouTube API keys or other credentials
3. **Review Permissions**: Be aware of what directories Spiralmem accesses
4. **Regular Backups**: Back up your database files if they contain important data
5. **Network Security**: Spiralmem only makes network requests to YouTube (when processing URLs)

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine affected versions
2. Audit code to find any similar problems
3. Prepare patches for all supported versions
4. Release patched versions as soon as possible
5. Publicly disclose the vulnerability after patches are available

Thank you for helping keep Spiralmem and our users safe!