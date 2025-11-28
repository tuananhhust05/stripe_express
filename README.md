# Shadow Link

Single Express.js application that powers the Shadow Link landing page, Stripe-powered checkout, activation code issuance, and macOS app integration.

## Stack

- Node.js + Express + EJS
- MongoDB (via Mongoose)
- Stripe Checkout + webhooks
- Nodemailer for activation emails
- Docker & Docker Compose for local orchestration

## Getting Started

1. Copy `env.example` to `.env` (or export the variables another way) and fill in:
   - Mongo connection string
   - **API_SECRET** - Secret key for macOS app API authentication (required for `/api/validate` and `/api/status/:code`)
   - Stripe secret/publishable keys, price IDs, webhook secret
   - SMTP credentials for email delivery
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run locally:
   ```bash
   npm run dev
   ```
4. Visit `https://www.vtoobe.com` for the landing page or `/payment` for checkout.

### Docker

**Production-style**
```bash
docker compose up --build
```

**Hot reload (nodemon)**
```bash
docker compose -f docker-compose.dev.yml up --build
```

The dev compose file mounts your local source into the container and runs `npm run dev`, so every code change triggers an automatic server restart. The standard compose file runs the compiled app with `npm start`.

## API Surface

### Public Endpoints

| Method | Route                      | Description                                  |
| ------ | -------------------------- | -------------------------------------------- |
| POST   | `/api/checkout-session`    | Creates a Stripe Checkout session            |
| GET    | `/api/transactions`        | Returns the latest recorded Stripe checkouts |
| GET    | `/api/health`              | Simple heartbeat                             |
| POST   | `/webhook/stripe`          | Stripe webhook to mint/send activation codes |

### macOS App API (Protected with API_SECRET)

These endpoints require the `X-API-Secret` header or `secret` query parameter.

| Method | Route                      | Description                                  | Auth Required |
| ------ | -------------------------- | -------------------------------------------- | ------------- |
| POST   | `/api/validate`            | Validates activation code, returns plan/expiry | ✅ Yes        |
| GET    | `/api/status/:code`        | Returns detailed activation code information  | ✅ Yes        |

**Example Request:**
```bash
curl -X POST https://your-domain.com/api/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: your-secret-key" \
  -d '{"activationCode": "ABC123..."}'
```

**Response Format:**
```json
{
  "valid": true,
  "plan": "monthly",
  "expiryDate": "2024-02-15T00:00:00.000Z",
  "status": "active",
  "email": "user@example.com"
}
```

### Legacy Endpoint (Backward Compatible)

| Method | Route                      | Description                                  |
| ------ | -------------------------- | -------------------------------------------- |
| POST   | `/api/activations/verify`  | Validates an activation code (no auth)       |

### Activation Flow

1. Customer selects plan on `/payment` and completes Stripe Checkout.
2. Stripe webhook (`checkout.session.completed`) hits `/webhook/stripe`.
3. Server stores activation in MongoDB and emails the code to the buyer.
4. macOS app calls `/api/validate` with the code and `X-API-Secret` header to confirm access.

## Frontend

The landing, payment, and `/transactions` history pages are rendered via EJS in the same Express app (no separate SPA). Styles live in `public/css/styles.css`.

