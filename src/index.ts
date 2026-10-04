import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";

type Env = {
  DATABASE_URL: string;
  ADMIN_PASSWORD: string;
};

type AdminTokenPayload = { role: "ADMIN"; exp: number };
const app = new Hono<{ Bindings: Env }>();

function sqlFor(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL secret is missing");
  return neon(env.DATABASE_URL);
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
}
async function createAdminToken(secret: string): Promise<string> {
  const payload: AdminTokenPayload = { role: "ADMIN", exp: Math.floor(Date.now() / 1000) + 3600 };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${await hmacSign(encodedPayload, secret)}`;
}
async function verifyAdminToken(token: string, secret: string): Promise<boolean> {
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return false;
    const expected = await hmacSign(encodedPayload, secret);
    if (!timingSafeEqual(signature, expected)) return false;
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminTokenPayload;
    return payload.role === "ADMIN" && payload.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

async function requireAdmin(c: any, next: any) {
  const secret = c.env.ADMIN_PASSWORD;
  if (!secret) return c.json({ success: false, message: "ADMIN_PASSWORD secret is missing." }, 500);
  const auth = c.req.header("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ success: false, message: "Admin authentication required." }, 401);
  if (!(await verifyAdminToken(match[1], secret))) {
    return c.json({ success: false, message: "Invalid or expired admin token." }, 401);
  }
  await next();
}

app.get("/", (c) => c.json({ success: true, name: "Room For Rent API", version: "1.1.0", health: "/health", admin_login: "/api/v1/admin/login" }));

app.get("/health", async (c) => {
  try {
    const sql = sqlFor(c.env);
    const rows = await sql`SELECT current_database() AS database_name, current_user AS database_user, NOW() AS server_time`;
    return c.json({ success: true, message: "Room For Rent API is connected to Neon.", database: rows[0] });
  } catch (e) {
    return c.json({ success: false, message: "Database connection failed", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get("/api/v1/public/categories", (c) => c.json({ success: true, data: ["Bed Space", "Shared Room", "Partition", "Studio", "Flatmate", "Bachelor Accommodation", "Apartment", "Villa"] }));
app.get("/api/v1/public/locations", (c) => c.json({ success: true, data: { country: "United Arab Emirates", emirates: ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"], examples: ["Mussafah", "Mohamed Bin Zayed City", "Khalifa City", "Al Nahyan", "Al Nahda"] } }));

app.get("/api/v1/public/listings", async (c) => {
  try {
    const sql = sqlFor(c.env);
    const rows = await sql`
      SELECT id, title, description, category, price_aed, emirate, area, furnished,
             private_bathroom, kitchen, wifi, parking, status, is_verified, created_at
      FROM listings
      WHERE status IN ('APPROVED', 'ACTIVE')
      ORDER BY created_at DESC
      LIMIT 50`;
    return c.json({ success: true, data: rows });
  } catch (e) {
    return c.json({ success: false, message: "Could not load listings", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get("/api/v1/public/listings/:id", async (c) => {
  try {
    const sql = sqlFor(c.env);
    const id = c.req.param("id");
    const rows = await sql`
      SELECT id, title, description, category, price_aed, emirate, area, furnished,
             private_bathroom, kitchen, wifi, parking, status, is_verified, created_at
      FROM listings WHERE id = ${id} AND status IN ('APPROVED', 'ACTIVE') LIMIT 1`;
    if (!rows.length) return c.json({ success: false, message: "Listing not found" }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (e) {
    return c.json({ success: false, message: "Could not load listing", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.post("/api/v1/admin/login", async (c) => {
  try {
    const adminPassword = c.env.ADMIN_PASSWORD;
    if (!adminPassword) return c.json({ success: false, message: "ADMIN_PASSWORD secret is missing." }, 500);
    const body = await c.req.json<{ password?: string }>().catch(() => ({}));
    if (!body.password || !timingSafeEqual(body.password, adminPassword)) {
      return c.json({ success: false, message: "Invalid admin password." }, 401);
    }
    const token = await createAdminToken(adminPassword);
    return c.json({ success: true, message: "Admin login successful.", data: { token, token_type: "Bearer", expires_in: 3600 } });
  } catch (e) {
    return c.json({ success: false, message: "Admin login failed.", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function setStatus(c: any, status: "APPROVED" | "REJECTED" | "PAUSED") {
  try {
    const sql = sqlFor(c.env);
    const id = c.req.param("id");
    const rows = await sql`
      UPDATE listings SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, status, updated_at`;
    if (!rows.length) return c.json({ success: false, message: "Listing not found" }, 404);
    return c.json({ success: true, data: rows[0] });
  } catch (e) {
    return c.json({ success: false, message: "Could not update listing", error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

app.get("/api/v1/admin/listings", requireAdmin, async (c) => {
  try {
    const sql = sqlFor(c.env);
    const rows = await sql`
      SELECT id, title, category, price_aed, emirate, area, status, is_verified, created_at
      FROM listings ORDER BY created_at DESC LIMIT 100`;
    return c.json({ success: true, data: rows });
  } catch (e) {
    return c.json({ success: false, message: "Could not load admin listings", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
app.post("/api/v1/admin/listings/:id/approve", requireAdmin, (c) => setStatus(c, "APPROVED"));
app.post("/api/v1/admin/listings/:id/reject", requireAdmin, (c) => setStatus(c, "REJECTED"));
app.post("/api/v1/admin/listings/:id/pause", requireAdmin, (c) => setStatus(c, "PAUSED"));

app.post("/api/v1/auth/send-otp", (c) => c.json({ success: false, message: "OTP provider is not connected yet. Add the UAE SMS provider in the next phase." }, 501));
app.post("/api/v1/auth/verify-otp", (c) => c.json({ success: false, message: "OTP provider is not connected yet." }, 501));
app.get("/api/v1/me", (c) => c.json({ success: false, message: "Authentication is required." }, 401));
app.post("/api/v1/listings", (c) => c.json({ success: false, message: "Login is required before creating a listing." }, 401));
app.post("/api/v1/listings/:id/submit", (c) => c.json({ success: false, message: "Login is required before submitting a listing." }, 401));
app.post("/api/v1/favorites", (c) => c.json({ success: false, message: "Login is required to sync favorites." }, 401));

app.notFound((c) => c.json({ success: false, message: "Route not found" }, 404));
app.onError((e, c) => c.json({ success: false, message: "Internal server error", error: e.message }, 500));

export default app;
