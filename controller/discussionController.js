import pool from "../config/dbConfig.js";

/* ====================================================
   Ensure Trip Discussions Table Exists
==================================================== */
const ensureDiscussionsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trip_discussions (
        id SERIAL PRIMARY KEY,
        trip_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        user_photo VARCHAR(500),
        user_role VARCHAR(50) DEFAULT 'traveler',
        message TEXT NOT NULL,
        is_announcement BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (error) {
    console.warn("Discussions table initialization warning:", error.message);
  }
};

/* ====================================================
   Check if User is Host or Joined Traveler
==================================================== */
export const checkUserTripAccess = async (req, res) => {
  try {
    const { tripId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(200).json({
        success: true,
        hasAccess: false,
        reason: "unauthenticated",
      });
    }

    const formattedTripId = String(tripId);

    // 1. Check if user is the Host of the trip
    const { rows: tripRows } = await pool.query(
      `SELECT host_id FROM trips WHERE id::text = $1 LIMIT 1`,
      [formattedTripId]
    );

    if (tripRows.length > 0 && String(tripRows[0].host_id) === String(userId)) {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        role: "host",
      });
    }

    // 2. Check if user has a confirmed booking for this trip
    const { rows: bookingRows } = await pool.query(
      `
      SELECT id, booking_status 
      FROM bookings 
      WHERE trip_id::text = $1 
        AND user_id = $2 
        AND (booking_status = 'confirmed' OR payment_status = 'paid')
      LIMIT 1
      `,
      [formattedTripId, userId]
    );

    if (bookingRows.length > 0) {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        role: "traveler",
      });
    }

    // Also check if admin
    if (req.user?.role === "admin") {
      return res.status(200).json({
        success: true,
        hasAccess: true,
        role: "admin",
      });
    }

    return res.status(200).json({
      success: true,
      hasAccess: false,
      reason: "not_joined",
    });
  } catch (error) {
    console.error("Check User Trip Access Error:", error);
    return res.status(500).json({
      success: false,
      hasAccess: false,
      message: "Failed to verify trip access.",
    });
  }
};

/* ====================================================
   Get Trip Discussions
==================================================== */
export const getTripDiscussions = async (req, res) => {
  try {
    await ensureDiscussionsTable();
    const { tripId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT 
        id,
        trip_id AS "tripId",
        user_id AS "userId",
        user_name AS "userName",
        user_photo AS "userPhoto",
        user_role AS "userRole",
        message,
        is_announcement AS "isAnnouncement",
        created_at AS "createdAt"
      FROM trip_discussions
      WHERE trip_id::text = $1
      ORDER BY created_at ASC;
      `,
      [String(tripId)]
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      discussions: rows,
    });
  } catch (error) {
    console.error("Get Trip Discussions Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trip discussions.",
      error: error.message,
    });
  }
};

/* ====================================================
   Post Discussion Message (Joined Travelers & Host Only)
==================================================== */
export const postDiscussionMessage = async (req, res) => {
  try {
    await ensureDiscussionsTable();
    const userId = req.user?.id;
    const userName = req.user?.full_name || req.user?.name || "Traveler";
    const userPhoto = req.user?.profile_image || "";

    const { tripId, message, isAnnouncement } = req.body || {};
    const formattedTripId = String(tripId).trim();

    if (!formattedTripId) {
      return res.status(400).json({ success: false, message: "Trip ID is required." });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message content cannot be empty." });
    }

    // Verify Access: Must be Host, Admin, or Joined Traveler
    const { rows: tripRows } = await pool.query(
      `SELECT host_id FROM trips WHERE id::text = $1 LIMIT 1`,
      [formattedTripId]
    );

    const isHost = tripRows.length > 0 && String(tripRows[0].host_id) === String(userId);
    const isAdmin = req.user?.role === "admin";

    let userRole = isHost ? "host" : (isAdmin ? "admin" : "traveler");

    if (!isHost && !isAdmin) {
      const { rows: bookingRows } = await pool.query(
        `
        SELECT id FROM bookings 
        WHERE trip_id::text = $1 
          AND user_id = $2 
          AND (booking_status = 'confirmed' OR payment_status = 'paid')
        LIMIT 1
        `,
        [formattedTripId, userId]
      );

      if (bookingRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Only travelers with confirmed bookings can chat in this room.",
        });
      }
    }

    const announcementFlag = Boolean(isAnnouncement && (isHost || isAdmin));

    const { rows } = await pool.query(
      `
      INSERT INTO trip_discussions (trip_id, user_id, user_name, user_photo, user_role, message, is_announcement, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING 
        id,
        trip_id AS "tripId",
        user_id AS "userId",
        user_name AS "userName",
        user_photo AS "userPhoto",
        user_role AS "userRole",
        message,
        is_announcement AS "isAnnouncement",
        created_at AS "createdAt";
      `,
      [formattedTripId, userId, userName, userPhoto, userRole, message.trim(), announcementFlag]
    );

    const newMessage = rows[0];

    // Emit via Socket.io Room if attached to express app
    const io = req.app.get("io");
    if (io) {
      io.to(`trip_room_${formattedTripId}`).emit("receive_message", newMessage);
    }

    return res.status(201).json({
      success: true,
      message: "Message posted successfully!",
      discussion: newMessage,
    });
  } catch (error) {
    console.error("Post Discussion Message Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to post message.",
      error: error.message,
    });
  }
};

/* ====================================================
   Delete Discussion Message (Author or Host Only)
==================================================== */
export const deleteDiscussionMessage = async (req, res) => {
  try {
    await ensureDiscussionsTable();
    const { id } = req.params;
    const userId = req.user?.id;

    const { rows: msgRows } = await pool.query(
      `SELECT id, trip_id, user_id FROM trip_discussions WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );

    if (msgRows.length === 0) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    const msg = msgRows[0];
    const isAuthor = String(msg.user_id) === String(userId);

    // Check if host
    const { rows: tripRows } = await pool.query(
      `SELECT host_id FROM trips WHERE id::text = $1 LIMIT 1`,
      [String(msg.trip_id)]
    );

    const isHost = tripRows.length > 0 && String(tripRows[0].host_id) === String(userId);
    const isAdmin = req.user?.role === "admin";

    if (!isAuthor && !isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this message.",
      });
    }

    await pool.query(`DELETE FROM trip_discussions WHERE id = $1`, [Number(id)]);

    // Emit via Socket.io Room
    const io = req.app.get("io");
    if (io) {
      io.to(`trip_room_${msg.trip_id}`).emit("delete_message", { messageId: Number(id) });
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully!",
    });
  } catch (error) {
    console.error("Delete Discussion Message Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete message.",
      error: error.message,
    });
  }
};
