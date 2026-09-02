# RepoMed API Documentation

## Overview

All API endpoints are Supabase Edge Functions. Endpoints requiring authentication use JWT Bearer tokens obtained from Supabase Auth.

## Base URL

- Production: `https://[YOUR_PROJECT].supabase.co/functions/v1`
- Local: `http://localhost:54321/functions/v1`

## Authentication

### JWT Bearer Token

Include in request headers:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Obtain token via:
```javascript
const { data: { session } } = await supabaseClient.auth.getSession();
const token = session?.access_token;
```

### HMAC Signature (Razorpay Webhook)

Razorpay sends HMAC-SHA256 signature in `X-Razorpay-Signature` header. Verified server-side against `RAZORPAY_WEBHOOK_SECRET`.

## Error Responses

All error responses follow this format:
```json
{
  "error": "Human-readable error message"
}
```

HTTP Status Codes:
- `200` - Success
- `400` - Bad request (invalid parameters)
- `401` - Unauthorized (missing/invalid JWT)
- `404` - Not found (product, user, etc.)
- `500` - Server error
- `502` - External service error (Razorpay, etc.)

---

## Endpoints

### 1. Get Questions

**Endpoint**: `POST /get-questions`

**Authentication**: Required (JWT Bearer Token)

**Description**: Fetch filtered and paginated questions for a subject.

**Request Body**:
```json
{
  "subject": "Anatomy",
  "years": ["2023", "2024"],
  "topics": ["Bones", "Muscles"],
  "subtopics": ["Long bones"],
  "exams": ["NEET", "GMC"],
  "marks": "1",
  "types": ["LAQ", "SAQ"],
  "search": "femur",
  "sortBy": "year",
  "sortOrder": "desc",
  "page": 0,
  "pageSize": 250,
  "includeOptions": true
}
```

**Request Parameters**:
- `subject` (string, required): Subject name
- `years` (array, optional): Filter by exam years
- `topics` (array, optional): Filter by topics
- `subtopics` (array, optional): Filter by subtopics
- `exams` (array, optional): Filter by exam type
- `marks` (string, optional): Filter by marks (single value)
- `types` (array, optional): Filter by question type (LAQ/SAQ/VSQ/CASE)
- `search` (string, optional): Full-text search query
- `sortBy` (string, optional): Sort field (default: "year")
- `sortOrder` (string, optional): "asc" or "desc" (default: "desc")
- `page` (number, optional): Page number (default: 0)
- `pageSize` (number, optional): Questions per page (max: 250 for premium, 10 for free)
- `includeOptions` (boolean, optional): Include multiple choice options

**Response**:
```json
{
  "questions": [
    {
      "id": "uuid",
      "subject": "Anatomy",
      "year": 2023,
      "exam": "NEET",
      "topic": "Bones",
      "subtopic": "Long bones",
      "marks": 1,
      "type": "LAQ",
      "question": "Describe the anatomy of femur",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "..."
    }
  ],
  "total": 150,
  "hasMore": true,
  "filterOptions": {
    "years": ["2023", "2024"],
    "topics": ["Bones", "Muscles"],
    "subtopics": ["Long bones", "Short bones"],
    "exams": ["NEET", "GMC"],
    "marks": ["1", "2", "3"],
    "types": ["LAQ", "SAQ", "VSQ", "CASE"]
  }
}
```

---

### 2. Get Products

**Endpoint**: `GET /get-products`

**Authentication**: Not required

**Description**: Fetch all available subscription plans.

**Response**:
```json
{
  "products": [
    {
      "id": "uuid",
      "code": "ANATOMY_2024",
      "name": "Anatomy 2024",
      "academic_year": "2024",
      "price_paise": 5000,
      "active": true,
      "all_access": false,
      "product_subjects": [
        { "subject_key": "Anatomy" }
      ]
    },
    {
      "id": "uuid",
      "code": "GOLD",
      "name": "Gold - All Subjects",
      "academic_year": "2024",
      "price_paise": 10000,
      "active": true,
      "all_access": true,
      "product_subjects": []
    }
  ]
}
```

---

### 3. Create Razorpay Order

**Endpoint**: `POST /create-razorpay-order`

**Authentication**: Required (JWT Bearer Token)

**Description**: Create a payment order with Razorpay. Handles referral discount application.

**Request Body**:
```json
{
  "productCode": "ANATOMY_2024",
  "referralCode": "REF123ABC"
}
```

**Request Parameters**:
- `productCode` (string, required): Product code to purchase
- `referralCode` (string, optional): Referral code for discount

**Response**:
```json
{
  "paymentOrderId": "uuid",
  "productCode": "ANATOMY_2024",
  "productName": "Anatomy 2024",
  "razorpayOrderId": "order_123456",
  "keyId": "rzp_live_...",
  "amount": 5000,
  "currency": "INR",
  "referral": {
    "code": "REF123ABC",
    "discountPercent": 10,
    "originalAmount": 5000,
    "discountAmount": 500,
    "finalAmount": 4500
  }
}
```

**Status Codes**:
- `200` - Success
- `400` - Invalid product or referral code
- `401` - Unauthorized
- `404` - Product not found
- `500` - Server error
- `502` - Razorpay error

---

### 4. Verify Razorpay Payment

**Endpoint**: `POST /verify-razorpay-payment`

**Authentication**: Required (JWT Bearer Token)

**Description**: Verify payment signature and create user entitlements.

**Request Body**:
```json
{
  "razorpayOrderId": "order_123456",
  "razorpayPaymentId": "pay_123456",
  "razorpaySignature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d",
  "paymentOrderId": "uuid"
}
```

**Response**:
```json
{
  "success": true,
  "entitlementId": "uuid",
  "expiresAt": "2025-09-02T00:00:00Z"
}
```

---

### 5. Razorpay Webhook

**Endpoint**: `POST /razorpay-webhook`

**Authentication**: HMAC Signature (X-Razorpay-Signature header)

**Description**: Receives payment status updates from Razorpay.

**Triggered Events**:
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `refund.created`

**Request Header**:
```
X-Razorpay-Signature: 9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d
```

**Request Body** (varies by event type):
```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_123456",
        "order_id": "order_123456",
        "amount": 5000,
        "status": "captured",
        "notes": {
          "repo_med_user_id": "uuid",
          "product": "ANATOMY_2024"
        }
      }
    }
  }
}
```

---

### 6. Validate Referral Code

**Endpoint**: `POST /validate-referral-code`

**Authentication**: Required (JWT Bearer Token)

**Description**: Check if a referral code is valid for a product.

**Request Body**:
```json
{
  "referralCode": "REF123ABC",
  "productCode": "ANATOMY_2024"
}
```

**Response** (if valid):
```json
{
  "valid": true,
  "code": "REF123ABC",
  "discountPercent": 10,
  "originalAmount": 5000,
  "discountAmount": 500,
  "finalAmount": 4500
}
```

**Response** (if invalid):
```json
{
  "valid": false,
  "error": "Referral code has expired or is not applicable to this product"
}
```

---

### 7. Redeem Free Referral

**Endpoint**: `POST /redeem-free-referral`

**Authentication**: Required (JWT Bearer Token)

**Description**: Apply a free referral code (grants premium access without payment).

**Request Body**:
```json
{
  "referralCode": "FREE123ABC",
  "productCode": "ANATOMY_2024"
}
```

**Response**:
```json
{
  "success": true,
  "entitlementId": "uuid",
  "message": "Premium access activated",
  "expiresAt": "2025-09-02T00:00:00Z"
}
```

---

### 8. Export Questions

**Endpoint**: `POST /export-questions`

**Authentication**: Required (JWT Bearer Token)

**Description**: Export filtered questions as PDF or CSV file.

**Request Body**:
```json
{
  "format": "pdf",
  "subject": "Anatomy",
  "years": ["2023", "2024"],
  "topics": ["Bones"],
  "subtopics": [],
  "exams": [],
  "marks": "",
  "types": ["LAQ", "SAQ"]
}
```

**Request Parameters**:
- `format` (string, required): "pdf" or "csv"
- `subject` (string, required): Subject name
- Other filters: Same as `/get-questions`

**Response** (PDF/CSV file):
- `Content-Type: application/pdf` or `text/csv`
- Binary file data

**Response** (on error):
```json
{
  "error": "No questions match your filters"
}
```

---

### 9. Get My Entitlements

**Endpoint**: `GET /get-my-entitlements`

**Authentication**: Required (JWT Bearer Token)

**Description**: Get user's active subscriptions and access level.

**Response**:
```json
{
  "isPremium": true,
  "entitlements": [
    {
      "id": "uuid",
      "productCode": "ANATOMY_2024",
      "status": "active",
      "createdAt": "2024-09-02T00:00:00Z",
      "expiresAt": "2025-09-02T00:00:00Z",
      "revokedAt": null
    }
  ]
}
```

---

## Rate Limiting

Rate limits are not currently enforced but recommended:
- **Authentication endpoints**: 10 req/min per user
- **Question queries**: 60 req/min per user
- **Payment endpoints**: 5 req/min per user
- **Export endpoints**: 5 req/day per user (large operations)

## CORS Configuration

Allowed origins (configurable via `ALLOWED_ORIGINS` env var):
- `https://repomed.in`
- `https://www.repomed.in`
- `http://localhost:5500`
- `http://127.0.0.1:5500`

All requests must include valid `Origin` header.

## Testing

### Using cURL

```bash
# Get products
curl -X GET https://[PROJECT].supabase.co/functions/v1/get-products

# Get questions (with auth)
curl -X POST https://[PROJECT].supabase.co/functions/v1/get-questions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Anatomy","page":0,"pageSize":10}'
```

### Using JavaScript

```javascript
const { data, error } = await supabaseClient.functions.invoke('get-questions', {
  body: {
    subject: 'Anatomy',
    years: ['2023', '2024'],
    page: 0,
    pageSize: 10
  }
});
```

---

## Common Errors

### 401 Unauthorized
- Invalid or expired JWT token
- Token not included in Authorization header
- User session expired

**Solution**: Re-authenticate and obtain a new token

### 400 Bad Request
- Invalid request parameters
- Missing required fields
- Invalid data types

**Solution**: Check request payload format and field types

### 404 Not Found
- Product code doesn't exist
- Referral code invalid
- User not found

**Solution**: Verify product/referral codes and user exists

### 502 Bad Gateway
- Razorpay API unreachable
- External service error

**Solution**: Retry after a few seconds or contact support

---

## Changelog

### v1.0 (September 2, 2026)
- Initial API documentation
- All endpoints documented
- Example requests and responses provided

