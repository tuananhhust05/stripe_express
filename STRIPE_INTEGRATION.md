# Stripe Integration Guide

## Flow khi khách hàng bấm Checkout

### 1. **User clicks "Complete Purchase"**
- User điền email và chọn plan
- Click button "Complete Purchase"
- Frontend gọi `POST /api/checkout-session` với `{ email, planId }`

### 2. **Backend tạo Stripe Checkout Session** (nếu Stripe được config)
- Kiểm tra `hasStripeConfig()` - có STRIPE_SECRET_KEY và STRIPE_PUBLISHABLE_KEY không
- Nếu có → Tạo Stripe Checkout Session:
  - Mode: `payment` (one-time payment)
  - Customer email: email từ form
  - Metadata: `{ planId, email }` (để dùng trong webhook)
  - Line items: Price ID từ plan config
  - Success URL: `/payment/success?session_id={CHECKOUT_SESSION_ID}`
  - Cancel URL: `/payment/cancel`
- Trả về `{ sessionId, publishableKey }`

### 3. **Frontend redirect đến Stripe Checkout**
- Nếu nhận được `sessionId` → Dùng Stripe.js để redirect:
  ```javascript
  stripe.redirectToCheckout({ sessionId })
  ```
- User thanh toán trên Stripe Checkout page

### 4. **Stripe xử lý thanh toán**
- User nhập thẻ và thanh toán
- Stripe xử lý payment
- Sau khi thanh toán thành công → Stripe gửi webhook

### 5. **Stripe Webhook → Backend**
- Stripe gửi POST request đến `/webhook/stripe`
- Event type: `checkout.session.completed`
- Backend verify webhook signature với `STRIPE_WEBHOOK_SECRET`
- Xử lý webhook:
  - Lấy email và planId từ session metadata
  - Tạo activation code
  - Lưu transaction vào database
  - Gửi email với activation code

### 6. **User được redirect về Success Page**
- Sau khi thanh toán → Redirect về `/payment/success`
- Hiển thị thông báo: "Check your inbox for activation code"

## Cấu hình cần thiết

### Environment Variables (.env)
```env
# Stripe Keys
STRIPE_SECRET_KEY=sk_test_xxx          # Secret key từ Stripe Dashboard
STRIPE_PUBLISHABLE_KEY=pk_test_xxx     # Publishable key từ Stripe Dashboard
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Webhook signing secret

# Stripe Price IDs (tạo trong Stripe Dashboard)
STRIPE_PRICE_MONTHLY=price_xxx         # Price ID cho monthly plan
STRIPE_PRICE_LIFETIME=price_xxx        # Price ID cho lifetime plan
```

### Các bước setup trong Stripe Dashboard

1. **Tạo Products & Prices**
   - Vào Products → Create product
   - Monthly plan: $40, one-time payment
   - Lifetime plan: $120, one-time payment
   - Copy Price IDs vào `.env`

2. **Setup Webhook**
   - Vào Developers → Webhooks → Add endpoint
   - URL: `https://your-domain.com/webhook/stripe` (hoặc dùng ngrok cho local)
   - Events to listen: `checkout.session.completed`
   - Copy Webhook signing secret vào `.env`

3. **Test với Stripe Test Mode**
   - Dùng test cards: `4242 4242 4242 4242`
   - Expiry: bất kỳ date tương lai
   - CVC: bất kỳ 3 số

## Fallback Mode (không có Stripe)

Nếu không có Stripe config:
- Tự động chuyển sang manual mode
- Tạo activation code ngay lập tức
- Gửi email activation code
- Không cần thanh toán

## Code Flow

```
User clicks Checkout
    ↓
POST /api/checkout-session
    ↓
hasStripeConfig()?
    ├─ YES → Create Stripe Session → Redirect to Stripe
    │           ↓
    │       User pays on Stripe
    │           ↓
    │       Stripe Webhook → /webhook/stripe
    │           ↓
    │       Create activation + Send email
    │
    └─ NO → Manual mode
              ↓
          Create activation + Send email immediately
```

## Testing

1. **Test với Stripe Test Mode:**
   - Set STRIPE_SECRET_KEY và STRIPE_PUBLISHABLE_KEY (test keys)
   - Dùng ngrok để expose local webhook endpoint
   - Test với test cards

2. **Test Manual Mode:**
   - Không set Stripe keys
   - System tự động dùng manual mode

