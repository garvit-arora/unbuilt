# PayPal Sandbox setup

UNBUILT takes real PayPal Sandbox payments: PayPal REST Orders v2, the PayPal JS SDK for buyer approval, and a server-side capture. Sandbox money is test money, so no real funds move. Without the credentials below the app still runs, and every product page shows **"PayPal Sandbox not configured"** with the missing variable names. In that state there is no PayPal button, `POST /api/paypal/orders` answers `503 PAYPAL_NOT_CONFIGURED`, and nothing is simulated.

## 1. Create the Sandbox accounts

1. Sign in at [developer.paypal.com](https://developer.paypal.com) with any PayPal account.
2. Open **Testing Tools → Sandbox Accounts**. PayPal creates two accounts by default:
   - a **Business** account (`…@business.example.com`). It owns the REST app and receives the funds. In UNBUILT it is the merchant of record, shown to buyers as "UNBUILT Demo Merchant (PayPal Sandbox)".
   - a **Personal** account (`…@personal.example.com`). You use it to approve payments as the buyer.
3. If you need more buyers, click **Create account → Personal**. Choose a country with USD support (for example United States) and give it a PayPal balance.
4. To see a Personal account's password, open the account and choose **View/Edit account**.

## 2. Create the REST app

1. Open **Apps & Credentials** and make sure the toggle is set to **Sandbox**.
2. Click **Create App**, name it (for example `UNBUILT local`), choose **Merchant** and select the Sandbox **Business** account from step 1.
3. Copy the **Client ID** and **Secret**.

## 3. Configure UNBUILT

Put the values in `.env.local` (local development) or your host's environment settings. Never commit them.

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_ALLOW_LIVE=false
PAYPAL_CLIENT_ID=<Sandbox client id>
PAYPAL_CLIENT_SECRET=<Sandbox secret>
PAYPAL_CURRENCY=USD
# Optional: only for webhook delivery (section 5)
PAYPAL_WEBHOOK_ID=
# Optional alias, not read by any component. If set it must equal PAYPAL_CLIENT_ID.
NEXT_PUBLIC_PAYPAL_CLIENT_ID=
PAYPAL_MERCHANT_DISPLAY_NAME=UNBUILT Demo Merchant (PayPal Sandbox)
```

| Variable | Required | What it does |
|---|---|---|
| `PAYPAL_ENV` | yes (`sandbox`) | Selects `https://api-m.sandbox.paypal.com`. `live` is refused unless `PAYPAL_ALLOW_LIVE=true` is also set. |
| `PAYPAL_CLIENT_ID` | yes | Used server-side for OAuth. The server passes it to the PayPal button at request time, so you do not need to rebuild after setting it. |
| `PAYPAL_CLIENT_SECRET` | yes | Server only. It never reaches the browser and is never logged. |
| `PAYPAL_CURRENCY` | yes (`USD`) | Only USD is supported in this MVP. Any other value disables PayPal with reason `UNSUPPORTED_CURRENCY`. |
| `PAYPAL_WEBHOOK_ID` | no | The id of the webhook you create in section 5. |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | no | A documented alias. `npm run check:env` warns if it differs from `PAYPAL_CLIENT_ID`. |

Then:

```powershell
npm run check:env      # PayPal line: "configured (sandbox, USD, ...)"; no PayPal issues
npm run build; npm run start
```

`next dev` works too. Restart the server after you change `.env.local`.

## 4. Publish a purchasable offer

Only offers sold through the platform demo merchant can be bought. The seeded **LocalPilot Starter Kit** is one: a real downloadable guide that UNBUILT Labs sells for $15.00.

```powershell
npx supabase db reset
npm run seed
npm run seed -- --publish-demo-offer   # or sign in as builder@unbuilt.demo and click "Publish offer"
```

Offers from other builders are published as **Listing only**. UNBUILT does not collect money on a builder's behalf, and multiparty seller onboarding is not part of this MVP.

## 5. Webhooks (optional)

Synchronous capture plus reconciliation keep payments correct without webhooks. The product page reconciles an open order once on load, and the checkout polls `GET /api/paypal/orders/<id>/status?reconcile=1` while a capture is confirming.

`POST /api/webhooks/paypal` verifies every delivery through `POST /v1/notifications/verify-webhook-signature` (the raw body is embedded byte-for-byte) and records it in `webhook_events`, so a redelivery of a processed event is a no-op. A verified event is only used to find the payment: the status always comes from a fresh PayPal GET of the order, capture or refund. Without `PAYPAL_WEBHOOK_ID` the endpoint answers `503 WEBHOOK_NOT_CONFIGURED`.

To enable it:

1. In **Apps & Credentials → your app → Webhooks**, add `https://<your-public-host>/api/webhooks/paypal`. PayPal needs a public HTTPS URL, such as a deployed preview or a tunnel. `localhost` does not work.
2. Subscribe to these 7 events:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.PENDING`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.DECLINED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.REVERSED`
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

How events are handled:

- Order and capture events reconcile the payment exactly like `?reconcile=1`. They never change a payment that is already captured or refunded; a late or repeated `PAYMENT.CAPTURE.COMPLETED` is recorded as `IGNORED` (`stale`).
- `PAYMENT.CAPTURE.REFUNDED` (and `REVERSED` with a refund resource) finishes the matching UNBUILT refund, or records a refund issued in the PayPal dashboard as "Refund issued outside UNBUILT" and recomputes the refunded amount.
- `PAYMENT.CAPTURE.REVERSED` with a capture resource (a reversal or chargeback) opens a high-severity `capture_mismatch` flag for an admin. No status or refund amount is inferred from it.
- A processing error answers 500 so PayPal retries the delivery.

Admins can also reconcile without webhooks: `POST /api/admin/payments/reconcile` with `{}` reconciles every payment that has been pending for more than 10 minutes, and `{ "paymentId": "<id>" }` reconciles one payment.

## 6. The PayPal button

The checkout offers only the PayPal wallet button. Card, Pay Later and Venmo are disabled (`disable-funding=card,paylater,venmo`), which matches the order's `payment_source.paypal` experience context and the Sandbox personal-account flow. The amount always comes from the stored offer price on the server. The create-order request carries only `{ offerId }`; a body with any other field is rejected with 400.

## 7. Full manual payment walkthrough

1. Start the app with the credentials configured, then reset and seed the database and publish the LocalPilot offer (section 4).
2. Sign in as **buyer@unbuilt.demo** (password `UnbuiltDemo!2026`, or the value of `DEMO_ACCOUNT_PASSWORD`).
3. Open the LocalPilot product page: **Discover → Offline AI coding assistant → Builders → LocalPilot Starter Kit**, or `/products/<offer id>`. Read the disclosure: what you buy, that the product exists now, when you get access, the refund terms, and the merchant of record.
4. Click the yellow **PayPal** button. A PayPal Sandbox window opens.
5. Log in with the Sandbox **Personal** account from step 1 and click **Pay** (or **Complete Purchase**).
6. UNBUILT captures the order server-side. It verifies that the capture status is `COMPLETED` and that the amount, currency and `custom_id` match the payment row. Only then is the payment marked `COMPLETED`. The panel then shows the receipt with the PayPal capture id, the "PayPal Sandbox" badge and a **Download LocalPilot Starter Kit** link (`GET /api/products/<offer>/access`).
7. Check the result:
   - `/payments` shows the payment, its status history (`CREATED → APPROVAL_PENDING → CAPTURE_PENDING → COMPLETED`) and the financial summary (completed value $15.00, 1 transaction, 1 paid buyer).
   - The offline cluster's demand page counts 1 paid buyer and $15.00 completed Sandbox value.
   - In the PayPal developer dashboard, the Business account's activity lists the $15.00 payment.
8. Try the edge cases:
   - **Cancel** in the PayPal window: you see "Checkout cancelled, nothing was charged." The open order is reused by the next attempt, or it expires after 3 hours.
   - **Double click / reload**: the same PayPal order is reused (one `PayPal-Request-Id` per payment).
   - **Close the tab after approving**: when you reopen the product page, UNBUILT reconciles once, sees the approved order and offers **Complete payment**.
   - **Buy again**: you get `409 ALREADY_PURCHASED`. A fully refunded purchase can be bought again.

## 8. Refunds

1. As the buyer, open the receipt on the product page (or `/payments`). The **Refunds** box shows the refund terms, the window end date and the refundable amount. Enter a reason (and optionally a partial amount in USD) and click **Request refund**. Nothing is sent to PayPal yet.
2. Sign in as **admin@unbuilt.demo** and open `/payments#refund-queue`. Click **Approve and refund**. UNBUILT moves the payment to `REFUND_PENDING`, calls `POST /v2/payments/captures/{capture_id}/refund` with the refund's own `PayPal-Request-Id`, and finishes the refund when PayPal answers `COMPLETED`: the payment becomes `REFUNDED` (or `PARTIALLY_REFUNDED`) and the buyer gets a notification. **Reject** needs a note for the buyer.
3. Edge cases:
   - **PayPal unreachable or timed out**: the refund stays `PENDING` and the admin sees **Retry with PayPal**. The retry re-sends the same request with the same `PayPal-Request-Id`, so PayPal never refunds twice. Status polling and admin reconcile also re-send it automatically once it is older than 60 seconds.
   - **PayPal answers `PENDING`** (e.g. an eCheck-funded payment): the refund stays pending until the `PAYMENT.CAPTURE.REFUNDED` webhook, a reconcile, or **Check with PayPal** reads PayPal's final status.
   - **Window ended**: admins can still approve; the override is written to the audit log.
   - **Refund in the PayPal dashboard**: sign in to [sandbox.paypal.com](https://www.sandbox.paypal.com) as the **Business** account, open the payment in **Activity** and choose **Issue a refund**. With webhooks configured (section 5), UNBUILT records it as "Refund issued outside UNBUILT".
- AI output can never trigger a refund. Only a buyer request plus an admin action, or an admin-issued refund, reaches PayPal.

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "PayPal Sandbox not configured" lists `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | The variables are empty or not loaded. Set them and restart the server. `npm run check:env` shows the reason. |
| The panel shows no missing variables but is still not configured | `PAYPAL_ENV` is invalid, `live` was set without `PAYPAL_ALLOW_LIVE=true`, `PAYPAL_CURRENCY` is not USD, or `UNBUILT_FORCE_FALLBACKS=1` is set (test runs set it on purpose). |
| `503 PAYPAL_NOT_CONFIGURED` "PayPal credentials rejected" | The client id and secret do not match, or they are Live credentials. Copy both from the **Sandbox** tab of the app. |
| `502 PAYPAL_UNAVAILABLE` | PayPal was unreachable or returned 5xx. Nothing was charged. Try again. A retry reuses the same `PayPal-Request-Id`. |
| `422 PAYPAL_INSTRUMENT_DECLINED` | The Sandbox funding source was declined. The PayPal window restarts so you can choose another one. The next capture uses a new request id (`<payment>-capture-2`). |
| "Still confirming with PayPal…" | The capture is pending at PayPal or the response was lost. You will not be charged twice. Use **Check again** or look at `/payments`. A stale capture is safely re-sent after 30 s with the same request id. |
| `502 PAYPAL_CAPTURE_MISMATCH` | PayPal's capture did not match the payment, so it is not marked paid. A high-severity `capture_mismatch` flag is opened. An admin refunds the capture in the Sandbox dashboard. |
| `422 REFUND_NOT_ELIGIBLE` | The payment is not captured, the refund window ended (buyer requests only), a refund is already open, or the amount exceeds what remains. An admin `issue` while a request is open answers `409`: approve or reject the open request first. |
| `422 PAYPAL_REFUND_FAILED` | PayPal rejected the refund (for example `CAPTURE_FULLY_REFUNDED`). The refund is marked `FAILED` and the payment returns to its captured status. |
| `400 WEBHOOK_VERIFICATION_FAILED` | PayPal did not confirm the signature, or a PayPal header was missing. Check that `PAYPAL_WEBHOOK_ID` is the id of the webhook PayPal is calling. |
| The PayPal window does not open | A popup blocker is active, or the browser blocks third-party cookies for `sandbox.paypal.com`. Allow both for the site. |
| Product shows "Listing only" | The offer is not sold through the platform demo merchant (section 4). |
