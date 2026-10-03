# Room For Rent API

Cloudflare Workers API for Room For Rent UAE, connected to Neon PostgreSQL.

Required Production Worker secret: DATABASE_URL (your Neon connection string). Never commit the real value.

Deploy: npm install && npm run deploy

Main routes: /health, /api/v1/public/categories, /api/v1/public/locations, /api/v1/public/listings, /api/v1/public/listings/:id, /api/v1/admin/listings.
