import pool from "../config/dbConfig.js";

/* ====================================================
   Ensure Wishlists Table Exists
==================================================== */
const ensureWishlistsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trip_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_user_wishlist UNIQUE (user_id, trip_id)
      );
    `);
  } catch (error) {
    console.warn("Wishlists table initialization warning:", error.message);
  }
};

/* ====================================================
   Toggle Trip Wishlist Status
==================================================== */
export const toggleWishlist = async (req, res) => {
  try {
    await ensureWishlistsTable();
    const userId = req.userId;
    const { tripId } = req.body || {};

    const formattedTripId = tripId ? String(tripId).trim() : "";
    if (!formattedTripId) {
      return res.status(400).json({
        success: false,
        message: "Trip ID is required.",
      });
    }

    // Check if trip exists
    const tripCheck = await pool.query(`SELECT id FROM trips WHERE id::text = $1`, [formattedTripId]);
    if (tripCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Expedition / Trip not found.",
      });
    }

    // Check if already in wishlist
    const existing = await pool.query(
      `SELECT id FROM wishlists WHERE user_id = $1 AND trip_id = $2`,
      [userId, formattedTripId]
    );

    if (existing.rows.length > 0) {
      // Remove from wishlist
      await pool.query(`DELETE FROM wishlists WHERE user_id = $1 AND trip_id = $2`, [
        userId,
        formattedTripId,
      ]);
      return res.status(200).json({
        success: true,
        isWishlisted: false,
        message: "Removed from your Wishlist.",
      });
    } else {
      // Add to wishlist
      await pool.query(
        `INSERT INTO wishlists (user_id, trip_id, created_at) VALUES ($1, $2, NOW())`,
        [userId, formattedTripId]
      );
      return res.status(201).json({
        success: true,
        isWishlisted: true,
        message: "Saved to your Wishlist!",
      });
    }
  } catch (error) {
    console.error("Toggle Wishlist Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update wishlist.",
      error: error.message,
    });
  }
};

/* ====================================================
   Get User's Saved Wishlist Trips
==================================================== */
export const getUserWishlist = async (req, res) => {
  try {
    await ensureWishlistsTable();
    const userId = req.userId;

    const query = `
      SELECT 
        w.id AS wishlist_id,
        w.created_at AS saved_at,
        t.id AS trip_id,
        t.trip_name,
        t.trip_description,
        t.destination,
        t.start_location,
        t.category,
        t.price_per_person,
        t.start_date,
        t.end_date,
        t.status,
        u.full_name AS host_name,
        (
          SELECT image_url
          FROM trip_images ti
          WHERE ti.trip_id::text = t.id::text
          ORDER BY ti.is_cover DESC NULLS LAST, ti.id ASC
          LIMIT 1
        ) AS cover_image
      FROM wishlists w
      JOIN trips t ON w.trip_id::text = t.id::text
      JOIN users u ON t.host_id = u.id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC;
    `;

    const { rows } = await pool.query(query, [userId]);

    const trips = rows.map((row) => {
      let parsedDestination = row.destination;
      if (typeof row.destination === "string") {
        try {
          parsedDestination = JSON.parse(row.destination);
        } catch (e) {}
      }

      return {
        wishlistId: row.wishlist_id,
        savedAt: row.saved_at,
        tripId: row.trip_id,
        tripName: row.trip_name,
        description: row.trip_description,
        destination: parsedDestination,
        category: row.category,
        pricePerPerson: row.price_per_person,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        hostName: row.host_name,
        coverImage: row.cover_image || "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80",
      };
    });

    return res.status(200).json({
      success: true,
      count: trips.length,
      trips,
    });
  } catch (error) {
    console.error("Get User Wishlist Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist.",
      error: error.message,
    });
  }
};

/* ====================================================
   Get User's Saved Wishlist Trip IDs
==================================================== */
export const getUserWishlistIds = async (req, res) => {
  try {
    await ensureWishlistsTable();
    const userId = req.userId;

    const { rows } = await pool.query(`SELECT trip_id FROM wishlists WHERE user_id = $1`, [userId]);
    const wishlistIds = rows.map((r) => String(r.trip_id));

    return res.status(200).json({
      success: true,
      wishlistIds,
    });
  } catch (error) {
    console.error("Get Wishlist IDs Error:", error);
    return res.status(500).json({
      success: false,
      wishlistIds: [],
    });
  }
};
