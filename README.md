# VaultPay Financial Core

This project implements a security-first invoice and billing portal based on the handoff brief.

Roles:
- Admin: creates invoices, views all revenue and client data.
- Client: views only their own invoices and can pay them.
- Route guards: admin and client pages check the user role before rendering.
- Security: backend enforces JWT auth and invoice ownership checks to prevent IDOR.
- Payments: Stripe Checkout sessions are used and payment confirmation is trusted only from Stripe webhooks.

Environment variables:
- JWT_SECRET
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- APP_URL
- SMTP_USER
- SMTP_PASSWORD

Developer note:
- This repository was empty at the time of implementation; the code below was created from scratch to satisfy the technical handoff.
- Webhook verification uses the Stripe `constructEvent` API and the public signature from Stripe's servers before updating invoice state.
- PDF generation and email dispatch are triggered only after a verified webhook confirms payment.

Run locally:
1. Copy `.env.example` to `.env` and fill in values.
2. npm install
3. npm start
4. Open http://localhost:3000

Demo credentials:
- Admin: admin@nexusservices.com / Admin@123
- Client: evelyn@acmepartners.com / Client@123
