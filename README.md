# RepoMed - Digital PYQ Repository for Medical Students

RepoMed is a comprehensive web platform providing Previous Year Questions (PYQs) for medical students preparing for GMERS Gotri & BMC exams. The platform features user authentication, premium access tiers, integrated payments, and secure PDF/CSV export functionality.

## 🎯 Features

### User Management
- **Authentication**: Email/password sign-up and sign-in
- **OAuth**: Google authentication integration
- **Session Management**: Persistent sessions with auto-refresh
- **User Profiles**: Store and manage user metadata

### Premium Access
- **Tiered Access**: Free preview (10 questions) and premium plans
- **Flexible Plans**: Subject-specific and all-access packages
- **Payment Integration**: Razorpay-powered secure checkout
- **Referral System**: Earn discounts through referral codes

### Question Repository
- **Multi-Subject**: Anatomy, Physiology, Biochemistry, and more
- **Advanced Filtering**: Filter by year, topic, exam type, marks
- **Search**: Full-text search across questions
- **Pagination**: Efficient data loading with 250 questions per page
- **Export**: PDF (with watermark) and CSV export options

## 📋 Project Structure

```
├── index.html                 # Home page
├── subject.html              # Subject questions page
├── pricing.html              # Pricing/plans page
├── checkout.html             # Payment checkout page
│
├── auth.js                   # Authentication UI & logic
├── auth-protect.js           # Page access protection
├── subject.js                # Subject page business logic
├── plans.js                  # Pricing & checkout logic
├── supabase-config.js        # Supabase client initialization
│
├── *.css                     # Styling files
├── favicon_io/               # Favicon assets
│
├── supabase/                 # Backend configuration
│   ├── config.toml          # Deno functions configuration
│   ├── functions/           # Edge functions
│   │   ├── _shared/         # Shared utilities
│   │   ├── create-razorpay-order/
│   │   ├── export-questions/
│   │   ├── get-questions/
│   │   ├── get-products/
│   │   ├── verify-razorpay-payment/
│   │   ├── razorpay-webhook/
│   │   ├── validate-referral-code/
│   │   ├── redeem-free-referral/
│   │   └── get-my-entitlements/
│   └── migrations/          # Database schema migrations
│
├── scripts/                 # Utility scripts
│   └── import-questions.mjs # Question data import script
│
├── tests/                   # Test files
│   ├── question-access.test.mjs
│   └── razorpay-payment.test.mjs
│
└── libs/                    # Third-party libraries
    └── jspdf.umd.min.js     # PDF generation library
```

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ (for local development)
- Deno 1.40+ (for Supabase functions)
- Supabase account with a project
- Razorpay merchant account
- Google OAuth credentials (optional)

### Local Development

1. **Clone and Setup**
   ```bash
   git clone <repository-url>
   cd pyqrepo2
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

3. **Initialize Supabase Locally** (Optional)
   ```bash
   supabase start
   ```

4. **Run Local Server**
   ```bash
   # Using Python
   python3 -m http.server 5500
   
   # Or Node.js
   npx http-server -p 5500
   
   # Or Ruby
   ruby -run -ehttpd . -p5500
   ```

5. **Access Application**
   - Open http://localhost:5500 in your browser

### Running Tests

```bash
# Run unit tests
node tests/question-access.test.mjs
node tests/razorpay-payment.test.mjs

# Or using Deno
deno test tests/question-access.test.mjs
```

## 🔐 Security Configuration

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed authentication and OAuth setup instructions.

### Key Security Points
- **Credentials**: Store all sensitive credentials in `.env` files (never commit)
- **JWT Verification**: Supabase functions verify JWTs before processing requests
- **CORS**: Configured to allow only whitelisted origins
- **Razorpay Webhook**: Verified using HMAC signatures
- **Row Level Security**: Database tables enforce RLS policies

## 💳 Payment Integration

The platform uses **Razorpay** for payment processing:

1. **Order Creation**: `POST /functions/v1/create-razorpay-order`
   - Validates product availability
   - Applies referral discounts if applicable
   - Creates local payment record

2. **Payment Verification**: `POST /functions/v1/verify-razorpay-payment`
   - Validates Razorpay payment signature
   - Creates user entitlements
   - Sends confirmation email

3. **Webhook Handling**: `POST /functions/v1/razorpay-webhook`
   - Receives payment status updates from Razorpay
   - Updates database records
   - Triggers finalization logic

## 🗂️ Database Schema

Key tables:
- `auth.users` - Supabase authentication users
- `profiles` - User profile information
- `questions` - PYQ question repository
- `products` - Subscription plans
- `payment_orders` - Payment transaction records
- `user_entitlements` - User access/subscription records
- `referral_reservations` - Referral discount bookings

See `supabase/migrations/` for complete schema definitions.

## 📦 Deployment

### Supabase Functions

Deploy functions to Supabase:
```bash
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook
# ... deploy other functions
```

### Frontend Hosting

1. **Build** (if using build tools):
   ```bash
   npm run build
   ```

2. **Deploy to static host**:
   - Netlify
   - Vercel
   - GitHub Pages
   - AWS S3 + CloudFront
   - Supabase Hosting

## 🔧 Configuration Files

### `supabase-config.js`
Initializes Supabase client with public credentials.

**⚠️ IMPORTANT**: Only commit the `SUPABASE_ANON_KEY`. Never commit `SERVICE_ROLE_KEY`.

### `supabase/config.toml`
Deno functions configuration:
- Function settings and permissions
- JWT verification configuration
- Environment variable bindings

### `supabase/migrations/`
Database schema versioning:
- Run automatically on deployment
- Version-controlled schema changes
- Idempotent and reversible

## 📝 API Documentation

See [API_DOCS.md](./API_DOCS.md) for comprehensive API endpoint documentation.

### Key Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/get-questions` | POST | JWT | Fetch filtered questions |
| `/get-products` | GET | None | List available plans |
| `/create-razorpay-order` | POST | JWT | Initialize payment |
| `/verify-razorpay-payment` | POST | JWT | Confirm payment |
| `/razorpay-webhook` | POST | HMAC | Handle payment updates |
| `/validate-referral-code` | POST | JWT | Check referral validity |
| `/export-questions` | POST | JWT | Export questions PDF/CSV |
| `/get-my-entitlements` | GET | JWT | Check user access level |

## 🐛 Troubleshooting

### Authentication Issues
- Verify Supabase credentials in `supabase-config.js`
- Check browser console for error messages
- Ensure session persistence is enabled
- Clear browser cache and session storage

### Payment Issues
- Verify Razorpay keys in environment variables
- Check payment order status in database
- Review Razorpay webhook logs
- Ensure CORS is properly configured

### Question Loading Issues
- Verify database migrations have run
- Check user entitlements
- Review browser network tab for 401/403 errors
- Ensure JWT token is valid and not expired

## 📚 Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Razorpay API Guide](https://razorpay.com/docs/)
- [Deno Functions Guide](https://supabase.com/docs/guides/functions)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software. Unauthorized copying or use is prohibited.

## 📧 Contact & Support

For issues, feature requests, or questions, please contact the development team.

---

**Last Updated**: September 2, 2026
**Status**: Production Ready
