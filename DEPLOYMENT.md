# RepoMed Deployment Guide

## Overview

RepoMed consists of two parts:
1. **Frontend**: Static HTML/CSS/JavaScript files
2. **Backend**: Supabase Edge Functions and Database

This guide covers deploying both components to production.

## Prerequisites

- Supabase CLI installed (`npm install -g supabase`)
- Git repository configured
- Production Supabase project
- Production Razorpay merchant account
- Hosting provider (Netlify, Vercel, GitHub Pages, or custom)

## Part 1: Backend Deployment

### 1.1 Prepare Supabase Project

```bash
# Login to Supabase CLI
supabase login

# Link to production project
supabase link --project-ref your-project-ref

# Verify database migrations are up-to-date
supabase migration list
```

### 1.2 Configure Environment Variables

Set these in your Supabase project settings:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_MODE=live  # NOT test mode in production
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
ALLOWED_ORIGINS=https://repomed.in,https://www.repomed.in
PDF_EXPORT_MAX_QUESTIONS=500
CSV_EXPORT_MAX_QUESTIONS=500
```

**Supabase Project Console** → Settings → Edge Functions → Secrets

### 1.3 Deploy Functions

```bash
# Deploy all functions
supabase functions deploy

# Or deploy specific function
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook
supabase functions deploy get-questions
supabase functions deploy get-products
supabase functions deploy export-questions
supabase functions deploy validate-referral-code
supabase functions deploy redeem-free-referral
supabase functions deploy get-my-entitlements
```

### 1.4 Verify Deployment

```bash
# List deployed functions
supabase functions list

# Check function logs
supabase functions logs create-razorpay-order

# Test endpoint
curl -X POST https://your-project.supabase.co/functions/v1/get-products
```

### 1.5 Set Up Razorpay Webhook

1. **Razorpay Dashboard** → Settings → Webhooks
2. **Create Webhook**:
   - URL: `https://your-project.supabase.co/functions/v1/razorpay-webhook`
   - Events: Select `payment.authorized`, `payment.captured`, `payment.failed`
3. **Copy Webhook Secret** → Store in Supabase secrets as `RAZORPAY_WEBHOOK_SECRET`

### 1.6 Run Database Migrations

```bash
# Migrations run automatically on deploy, but verify:
supabase db pull  # Verify schema locally

# If migrations fail, check logs
supabase db remote set  # Sync remote schema
```

## Part 2: Frontend Deployment

### 2.1 Prepare Repository

```bash
# Ensure all files are clean
git status

# Create production build (if using build tools)
npm run build  # or your build command

# For static deployment, no build needed
```

### 2.2 Update Configuration

1. **supabase-config.js**: Verify production Supabase URL

```javascript
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your_anon_key_here";
```

2. **Update Domain References**:
   - HTML files: Verify domain-specific links
   - Add Razorpay script tag: Ensure production key used

3. **Update CNAME** (if using custom domain):
   - Keep CNAME file with your custom domain

### 2.3 Deploy to Hosting Provider

#### Option A: Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod --dir=.

# Configure:
# - Build command: (none - static site)
# - Publish directory: .
```

**netlify.toml** (optional):
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build]
  command = ""
  publish = "."
```

#### Option B: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod

# Configure when prompted
```

**vercel.json**:
```json
{
  "buildCommand": "echo 'static site'",
  "outputDirectory": "."
}
```

#### Option C: GitHub Pages

```bash
# Push to GitHub
git add .
git commit -m "Production deployment"
git push origin main

# Enable in repository settings
# Settings → Pages → Source: main branch
```

**_config.yml**:
```yaml
baseurl: /
url: https://yourdomain.com
```

#### Option D: AWS S3 + CloudFront

```bash
# Create S3 bucket
aws s3 mb s3://repomed-production

# Sync files
aws s3 sync . s3://repomed-production --delete

# Create CloudFront distribution
aws cloudfront create-distribution \
  --origin-domain-name repomed-production.s3.amazonaws.com
```

### 2.4 Configure SSL/TLS

- All major hosts provide free SSL (Let's Encrypt)
- Netlify: Automatic via Let's Encrypt
- Vercel: Automatic
- AWS: Use ACM certificate
- Custom: Use Certbot with nginx/apache

### 2.5 Configure Domain DNS

Point your domain to your hosting provider:

**Example for Netlify**:
```
Type: CNAME
Name: www
Value: repomed-production.netlify.app

Type: A
Name: @
Value: [Netlify IP]
```

### 2.6 Verify Deployment

1. **Visit Domain**: https://repomed.in
2. **Test Features**:
   - Sign in with email/password
   - Sign in with Google
   - Browse questions
   - Attempt checkout (test mode)
3. **Check Console**: No errors in browser dev tools
4. **Test APIs**:
   ```bash
   curl https://your-project.supabase.co/functions/v1/get-products
   ```

## Part 3: Post-Deployment

### 3.1 Monitoring

**Supabase Monitoring**:
- Dashboard → Logs → Functions (check for errors)
- Dashboard → Analytics (track usage)
- Dashboard → Reports (security and performance)

**Hosting Monitoring**:
- Netlify → Analytics → Performance
- Vercel → Deployments → Analytics
- CloudWatch (AWS)

### 3.2 Backup Strategy

```bash
# Backup Supabase database
supabase db export
pg_dump "postgres://..." > backup.sql

# Backup to S3
aws s3 cp backup.sql s3://backups/

# Schedule daily backups via cron
0 2 * * * /path/to/backup-script.sh
```

### 3.3 Logging & Alerts

**Error Logging**:
```javascript
// In frontend code
console.error("Error:", error);
// Logs appear in browser and hosting provider logs

// In functions
console.error("Function error:", error);
// Logs appear in Supabase function logs
```

**Set Up Alerts**:
- Supabase: Monitor error rates
- Hosting: Configure uptime alerts
- Payment: Monitor Razorpay webhook failures
- Database: Configure backup failure alerts

### 3.4 Performance Optimization

```bash
# Analyze bundle size
npm run build --analyze

# Optimize images
npx imagemin *.png --out-dir=optimized

# Minify CSS/JS
npx terser plans.js -o plans.min.js
npx cssnano index.css -o index.min.css
```

Update HTML to use minified versions:
```html
<link rel="stylesheet" href="index.min.css" />
<script src="plans.min.js"></script>
```

### 3.5 Security Hardening

1. **Set Security Headers**:
   ```
   Strict-Transport-Security: max-age=31536000
   Content-Security-Policy: default-src 'self'
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   ```

2. **Configure Hosting Provider Security**:
   - Enable DDoS protection
   - Set up WAF rules
   - Enable access logs

3. **Regular Updates**:
   ```bash
   npm audit
   npm audit fix
   supabase functions list  # Check for outdated dependencies
   ```

## Part 4: Rollback Plan

If deployment causes issues:

### Rollback Functions
```bash
# Revert to previous function version
supabase functions deploy create-razorpay-order \
  --project-ref your-project-ref

# Or via Git
git revert HEAD~1
supabase functions deploy
```

### Rollback Frontend
```bash
# Netlify
netlify deploy --prod --alias=rollback [previous-build-id]

# Vercel
vercel --prod --alias=rollback [previous-deployment]

# GitHub Pages
git revert HEAD
git push origin main
```

### Rollback Database
```bash
# Backup to restore from
pg_restore "postgres://..." < backup.sql

# Or use Supabase UI to restore from backup
```

## Part 5: Maintenance

### Daily
- Monitor error logs
- Check transaction volumes
- Verify backups completed

### Weekly
- Review analytics
- Update dependencies (if patches available)
- Test referral code system
- Verify payment webhook logs

### Monthly
- Security audit checklist
- Performance review
- Optimize database queries
- Update documentation

### Quarterly
- Penetration testing
- Rotate API keys
- Database optimization
- Disaster recovery drill

## Troubleshooting

### Functions Not Deploying
```bash
# Check syntax
supabase functions validate create-razorpay-order

# View detailed error
supabase functions deploy --debug
```

### Payment Webhook Not Working
1. Verify webhook URL is correct
2. Check RAZORPAY_WEBHOOK_SECRET in Supabase
3. Review webhook logs in Razorpay dashboard
4. Test with Razorpay webhook tester

### Database Migration Failed
```bash
# Reset local database
supabase db reset

# Sync with remote
supabase db pull

# Apply migrations
supabase db push
```

### High Latency
- Check function logs for slow queries
- Optimize database indexes
- Enable CDN caching on frontend
- Monitor Razorpay API latency

## Support

For deployment issues:
1. Check logs: Supabase → Logs → Functions
2. Review status: Dashboard → Status
3. Consult docs: README.md, API_DOCS.md
4. Open issue: Include logs and reproduction steps

---

**Deployment Checklist**:
- [ ] Environment variables configured
- [ ] Functions deployed and tested
- [ ] Database migrations applied
- [ ] Razorpay webhook configured
- [ ] Frontend deployed
- [ ] Domain DNS configured
- [ ] SSL/TLS verified
- [ ] All features tested in production
- [ ] Monitoring and alerts set up
- [ ] Backup strategy implemented

**Deployment completed**: Document date, version, and any notes for rollback reference.
