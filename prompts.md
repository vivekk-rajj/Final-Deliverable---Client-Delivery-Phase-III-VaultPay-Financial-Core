# Prompts.md

This project includes a minimal AI-assisted workflow and uses the following approach:

1. AI was used to shape the security-first architecture and route guard logic.
2. Stripe webhook validation was implemented using the official `stripe.webhooks.constructEvent` pattern to verify the signature before trusting payment events.
3. Invoice PDF generation was paired with an email dispatch flow triggered only after payment confirmation.
4. The workflow is documented here to stay transparent about AI assistance and to match the assignment requirements.

This project intentionally prioritizes:
- JWT auth on all protected API routes
- role-based access control on the server and client
- invoice ownership enforcement to avoid IDOR
- webhook-based payment finalization instead of trusting user-submitted success calls
