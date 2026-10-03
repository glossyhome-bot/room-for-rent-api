import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";

type Bindings = { DATABASE_URL: string };

const app = new Hono<{ Bindings: Bindings }>();

const sqlFor = (env: Bindings) => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL secret is missing");
  }

  return neon(env.DATABASE_URL);
};

app.get("/", (c) =>
  c.json({
    success: true,
    name: "Room For Rent API",
    version: "1.0.0",
    health: "/health",
  })
);

app.get("/health", async (c) => {
  try {
    const sql = sqlFor(c.env);

    const rows = await sql`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        NOW() AS server_time
    `;

    return c.json({
      success: true,
      message: "Room For Rent API is connected to Neon.",
      database: rows[0],
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        message: "Database connection failed",
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

app.get("/api/v1/public/categories", (c) =>
  c.json({
    success: true,
    data: [
      "Bed Space",
      "Shared Room",
      "Partition",
      "Studio",
      "Flatmate",
      "Bachelor Accommodation",
      "Apartment",
      "Villa",
    ],
  })
);

app.get("/api/v1/public/locations", (c) =>
  c.json({
    success: true,
    data: {
      country: "United Arab Emirates",
      emirates: [
        "Abu Dhabi",
        "Dubai",
        "Sharjah",
        "Ajman",
        "Umm Al Quwain",
        "Ras Al Khaimah",
        "Fujairah",
      ],
      examples: [
        "Mussafah",
        "Mohamed Bin Zayed City",
        "Khalifa City",
        "Al Nahyan",
        "Al Nahda",
      ],
    },
  })
);

app.get("/api/v1/public/listings", async (c) => {
  try {
    const sql = sqlFor(c.env);

    const rows = await sql`
      SELECT
        id,
        title,
        description,
        category,
        price_aed,
        emirate,
        area,
        furnished,
        private_bathroom,
        kitchen,
        wifi,
        parking,
        status,
        is_verified,
        created_at
      FROM listings
      WHERE status IN ('APPROVED', 'ACTIVE')
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return c.json({
      success: true,
      data: rows,
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        message: "Could not load listings",
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

app.get("/api/v1/public/listings/:id", async (c) => {
  try {
    const sql = sqlFor(c.env);
    const id = c.req.param("id");

    const rows = await sql`
      SELECT
        id,
        title,
        description,
        category,
        price_aed,
        emirate,
        area,
        furnished,
        private_bathroom,
        kitchen,
        wifi,
        parking,
        status,
        is_verified,
        created_at
      FROM listings
      WHERE id = ${id}
        AND status IN ('APPROVED', 'ACTIVE')
      LIMIT 1
    `;

    if (!rows.length) {
      return c.json(
        {
          success: false,
          message: "Listing not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: rows[0],
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        message: "Could not load listing",
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

app.get("/api/v1/admin/listings", async (c) => {
  try {
    const sql = sqlFor(c.env);

    const rows = await sql`
      SELECT
        id,
        title,
        category,
        price_aed,
        emirate,
        area,
        status,
        is_verified,
        created_at
      FROM listings
      ORDER BY created_at DESC
      LIMIT 100
    `;

    return c.json({
      success: true,
      data: rows,
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        message: "Could not load admin listings",
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
});

app.post("/api/v1/auth/send-otp", (c) =>
  c.json(
    {
      success: false,
      message:
        "OTP provider is not connected yet. Add the UAE SMS provider in the next phase.",
    },
    501
  )
);

app.post("/api/v1/auth/verify-otp", (c) =>
  c.json(
    {
      success: false,
      message: "OTP provider is not connected yet.",
    },
    501
  )
);

app.get("/api/v1/me", (c) =>
  c.json(
    {
      success: false,
      message: "Authentication is required.",
    },
    401
  )
);

app.post("/api/v1/listings", (c) =>
  c.json(
    {
      success: false,
      message: "Login is required before creating a listing.",
    },
    401
  )
);

app.post("/api/v1/listings/:id/submit", (c) =>
  c.json(
    {
      success: false,
      message: "Login is required before submitting a listing.",
    },
    401
  )
);

app.post("/api/v1/favorites", (c) =>
  c.json(
    {
      success: false,
      message: "Login is required to sync favorites.",
    },
    401
  )
);

async function setStatus(c: any, status: string) {
  try {
    const sql = sqlFor(c.env);
    const id = c.req.param("id");

    const rows = await sql`
      UPDATE listings
      SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, title, status, updated_at
    `;

    if (!rows.length) {
      return c.json(
        {
          success: false,
          message: "Listing not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: rows[0],
    });
  } catch (e) {
    return c.json(
      {
        success: false,
        message: "Could not update listing",
        error: e instanceof Error ? e.message : String(e),
      },
      500
    );
  }
}

app.post("/api/v1/admin/listings/:id/approve", (c) =>
  setStatus(c, "APPROVED")
);

app.post("/api/v1/admin/listings/:id/reject", (c) =>
  setStatus(c, "REJECTED")
);

app.post("/api/v1/admin/listings/:id/pause", (c) =>
  setStatus(c, "PAUSED")
);

app.notFound((c) =>
  c.json(
    {
      success: false,
      message: "Route not found",
    },
    404
  )
);

app.onError((e, c) =>
  c.json(
    {
      success: false,
      message: "Internal server error",
      error: e.message,
    },
    500
  )
);

export default app;
