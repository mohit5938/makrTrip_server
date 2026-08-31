import pool from "../config/dbConfig.js";

/* ====================================================
   Ensure Reviews Table Exists & Supports Schema Variations
==================================================== */
const ensureReviewsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        trip_id VARCHAR(255) NOT NULL,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        reviewer_id INT REFERENCES users(id) ON DELETE CASCADE,
        host_id INT,
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Drop NOT NULL constraints on legacy columns if pre-existing
    try {
      await pool.query(`ALTER TABLE reviews ALTER COLUMN reviewer_id DROP NOT NULL;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ALTER COLUMN host_id DROP NOT NULL;`);
    } catch (e) {}

    // Ensure columns exist
    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id INT REFERENCES users(id) ON DELETE CASCADE;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS host_id INT;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS trip_id VARCHAR(255);`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ALTER COLUMN trip_id TYPE VARCHAR(255);`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating INT CHECK (rating >= 1 AND rating <= 5);`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    } catch (e) {}

  } catch (error) {
    console.warn("Reviews table initialization warning:", error.message);
  }
};

/* ====================================================
   Create or Update a Trip Review
==================================================== */
export const createReview = async (req, res) => {
  try {
    await ensureReviewsTable();
    const userId = req.userId;
    const { rating, comment } = req.body || {};
    const rawTripId = req.body?.tripId || req.body?.trip_id || req.body?.id || req.query?.tripId || req.query?.id;

    const tripId = rawTripId ? String(rawTripId).trim() : "";
    const numRating = Number(rating);

    if (!tripId) {
      return res.status(400).json({
        success: false,
        message: "Valid Trip ID is required.",
      });
    }

    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5 stars.",
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: "Review comment is required.",
      });
    }

    // Verify trip exists & get hostId
    const tripCheck = await pool.query(`SELECT id, host_id FROM trips WHERE id::text = $1`, [tripId]);
    if (tripCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Expedition / Trip not found.",
      });
    }

    const hostId = tripCheck.rows[0].host_id || null;

    let review;
    // Query populating trip_id, user_id, reviewer_id, host_id, rating, comment
    const query = `
      INSERT INTO reviews (trip_id, user_id, reviewer_id, host_id, rating, comment, created_at)
      VALUES ($1, $2, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    try {
      const { rows } = await pool.query(query, [tripId, userId, hostId, numRating, comment.trim()]);
      review = rows[0];
    } catch (insertErr) {
      if (insertErr.message.includes("host_id") || insertErr.message.includes("reviewer_id") || insertErr.message.includes("column")) {
        await pool.query(`ALTER TABLE reviews ALTER COLUMN host_id DROP NOT NULL;`).catch(() => {});
        await pool.query(`ALTER TABLE reviews ALTER COLUMN reviewer_id DROP NOT NULL;`).catch(() => {});
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS host_id INT;`).catch(() => {});
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id INT;`).catch(() => {});
        await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id INT;`).catch(() => {});

        const fallbackQuery = `
          INSERT INTO reviews (trip_id, user_id, reviewer_id, host_id, rating, comment, created_at)
          VALUES ($1, $2, $2, $3, $4, $5, NOW())
          RETURNING *;
        `;
        const { rows } = await pool.query(fallbackQuery, [tripId, userId, hostId, numRating, comment.trim()]);
        review = rows[0];
      } else {
        throw insertErr;
      }
    }

    // Recalculate host rating
    try {
      if (hostId) {
        await pool.query(
          `
          UPDATE hosts
          SET
            rating = (
              SELECT COALESCE(AVG(r.rating), 5.0)::numeric(3,2)
              FROM reviews r
              JOIN trips t ON r.trip_id::text = t.id::text
              WHERE t.host_id = $1
            ),
            total_reviews = (
              SELECT COUNT(*)::int
              FROM reviews r
              JOIN trips t ON r.trip_id::text = t.id::text
              WHERE t.host_id = $1
            )
          WHERE user_id = $1;
          `,
          [hostId]
        );
      }
    } catch (e) {
      console.warn("Host rating update warning:", e.message);
    }

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully!",
      review,
    });
  } catch (error) {
    console.error("Create Review Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit review: " + error.message,
      error: error.message,
    });
  }
};

/* ====================================================
   Get Trip Reviews & Rating Breakdown
==================================================== */
export const getTripReviews = async (req, res) => {
  try {
    await ensureReviewsTable();
    const { tripId } = req.params;

    const reviewsQuery = `
      SELECT 
        r.id,
        r.trip_id,
        COALESCE(r.user_id, r.reviewer_id) AS user_id,
        r.rating,
        r.comment,
        r.created_at,
        u.full_name AS reviewer_name,
        COALESCE(u.profile_image, u.profile_photo) AS reviewer_photo
      FROM reviews r
      JOIN users u ON u.id = COALESCE(r.user_id, r.reviewer_id)
      WHERE r.trip_id::text = $1
      ORDER BY r.created_at DESC;
    `;

    const { rows: reviews } = await pool.query(reviewsQuery, [String(tripId)]);

    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1)
      : "5.0";

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((r) => {
      if (distribution[r.rating] !== undefined) {
        distribution[r.rating] += 1;
      }
    });

    return res.status(200).json({
      success: true,
      reviews,
      totalReviews,
      avgRating: Number(avgRating),
      distribution,
    });
  } catch (error) {
    console.error("Get Trip Reviews Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trip reviews.",
      error: error.message,
    });
  }
};

/* ====================================================
   Get User's Reviewable Trips
==================================================== */
export const getUserReviewableTrips = async (req, res) => {
  try {
    await ensureReviewsTable();
    const userId = req.userId;

    const query = `
      SELECT 
        b.id AS booking_id,
        t.id AS trip_id,
        t.trip_name,
        t.destination,
        t.start_date,
        t.end_date,
        r.id AS review_id,
        r.rating AS existing_rating,
        r.comment AS existing_comment
      FROM bookings b
      JOIN trips t ON b.trip_id = t.id
      LEFT JOIN reviews r ON r.trip_id::text = t.id::text AND COALESCE(r.user_id, r.reviewer_id) = $1
      WHERE b.traveler_id = $1
      ORDER BY b.joined_at DESC;
    `;

    const { rows } = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      trips: rows,
    });
  } catch (error) {
    console.error("Get Reviewable Trips Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reviewable trips.",
    });
  }
};
