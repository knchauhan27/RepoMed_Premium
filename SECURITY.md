# RepoMed Security Policy

## 🔐 Security is Important

We take the security of RepoMed seriously. This document outlines our security practices and how to report vulnerabilities.

## 🚨 Reporting Security Vulnerabilities

**DO NOT** open public GitHub issues for security vulnerabilities. Instead:

1. **Email**: security@repomed.in (or appropriate contact)
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if applicable)

3. **Response Time**: We aim to acknowledge reports within 48 hours and provide updates every 5 days.

4. **Confidentiality**: We will not disclose vulnerability details until a fix is available and deployed.

## ✅ Security Best Practices

### Authentication & Authorization

- **JWT Validation**: All protected endpoints validate JWT tokens server-side
- **Session Management**: Sessions auto-refresh and are protected by HTTPS
- **Password Requirements**: Minimum 6 characters (enforced by Supabase)
- **OAuth**: Google OAuth uses secure PKCE flow
- **Row Level Security (RLS)**: Database enforces RLS policies for user data isolation

### Data Protection

- **HTTPS Only**: All connections use HTTPS in production
- **Data Encryption**: Sensitive data encrypted at rest via Supabase
- **PII Handling**: User emails are required but not publicly exposed
- **Payment Data**: Never stored locally; delegated to Razorpay
- **Database Backups**: Handled by Supabase with encryption

### API Security

- **CORS**: Restricted to whitelisted origins only
- **Input Validation**: All endpoints validate and sanitize inputs
- **Rate Limiting**: Recommended but not currently enforced
- **HMAC Signatures**: Razorpay webhooks verified via HMAC-SHA256
- **Error Handling**: Generic error messages prevent info leakage

### Frontend Security

- **XSS Prevention**: HTML escaping in dynamic content rendering
- **CSRF Protection**: Handled by Supabase Auth
- **Dependency Scanning**: jsPDF and other libraries from trusted sources
- **Minification**: Production code should be minified
- **CSP Headers**: Configure Content-Security-Policy on hosting platform

### Backend Security (Supabase Functions)

- **No Hardcoded Secrets**: All credentials via environment variables
- **Input Validation**: Schema validation on all request bodies
- **Error Logging**: Sensitive errors logged without exposing details
- **Timeout Protection**: Functions have execution timeouts
- **Resource Limits**: Prevent abuse via Supabase rate limiting

### Payment Security

- **Razorpay Integration**: PCI-DSS compliant payment processor
- **Signature Verification**: All webhooks verified with HMAC-SHA256
- **Order Verification**: Payment amounts verified against local database
- **User Verification**: Token verified before processing payment
- **Error Handling**: Payment errors logged but never exposed to client

## 🛡️ Security Configuration

### Environment Variables

**Never commit these to version control**:
```
SUPABASE_SERVICE_ROLE_KEY=...      # Server-side only
RAZORPAY_KEY_SECRET=...            # Server-side only
RAZORPAY_WEBHOOK_SECRET=...        # Server-side only
```

**Safe to commit (with caution)**:
```
SUPABASE_URL=...                   # Public, but verify it's production URL
SUPABASE_ANON_KEY=...              # Public anon key, no sensitive operations
```

### Credentials Rotation

- Rotate Razorpay keys quarterly
- Rotate Supabase service keys if compromised
- Monitor Supabase usage for unusual activity
- Review OAuth consent scopes periodically

## 🔍 Security Audit Checklist

Regular security reviews should verify:

- [ ] All `.env` files excluded from git
- [ ] No hardcoded API keys in code
- [ ] JWT validation on protected endpoints
- [ ] Input validation on all user inputs
- [ ] SQL injection prevention (Supabase handles this)
- [ ] XSS prevention in dynamic HTML
- [ ] CSRF token included in state-changing requests
- [ ] Rate limiting on public endpoints
- [ ] HTTPS enforced in production
- [ ] CORS properly configured
- [ ] Error messages don't leak sensitive info
- [ ] Razorpay webhooks properly verified
- [ ] Database RLS policies in place
- [ ] Session timeout configured
- [ ] Logs exclude sensitive data

## 📋 Security Standards

### Third-Party Services

**Supabase**:
- Enterprise security
- SOC 2 Type II compliant
- Encrypted backups
- 99.99% SLA

**Razorpay**:
- PCI-DSS Level 1 compliant
- ISO 27001 certified
- HTTPS/TLS 1.2+
- Fraud detection

**Google OAuth**:
- OAuth 2.0 + OpenID Connect
- Secure redirect URIs
- Client secret management

### Dependency Security

- Review dependencies for known vulnerabilities
- Use npm audit / deno audit regularly
- Keep dependencies up-to-date
- Remove unused dependencies

## 🐛 Known Issues & Mitigations

### Current Limitations

1. **No Rate Limiting**: Implement via Supabase functions or middleware
2. **Alert-based Errors**: Should be replaced with proper error UI
3. **No Input Validation UI**: Add visual feedback for invalid inputs
4. **No API Key Rotation**: Implement automated rotation policies

### Mitigations

- Monitor Supabase logs for unusual activity
- Implement alerting for suspicious patterns
- Regular security audits
- Penetration testing quarterly

## 🔄 Security Update Process

1. **Identify**: Security vulnerability identified
2. **Report**: Researcher reports via security email
3. **Assess**: Severity and impact evaluated
4. **Fix**: Patch developed and tested
5. **Release**: Fixed version deployed
6. **Notify**: Affected users notified
7. **Disclose**: Vulnerability details published after fix

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security Guide](https://supabase.com/docs/guides/self-hosting/security)
- [Razorpay Security](https://razorpay.com/security/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)

## 🤝 Community Security

If you discover a security issue:

1. **Do not** publicly disclose until a fix is available
2. **Contact** security team immediately
3. **Provide** detailed reproduction steps
4. **Be patient** while we investigate and develop a fix
5. **Cooperate** on verification of the patch

## 📝 Security Policy Updates

This security policy is subject to change. Updates will be:
- Announced in GitHub discussions
- Documented in CHANGELOG
- Reflected in deployments

**Last Updated**: September 2, 2026
**Next Review**: December 2, 2026
