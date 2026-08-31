import pool from "../config/dbConfig.js";

/* ====================================================
   Get Admin Stats Overview
==================================================== */
export const getAdminStats = async (req, res) => {
    try {
        const statsQuery = `
            SELECT
                (SELECT COUNT(*)::int FROM users) AS total_users,
                (SELECT COUNT(*)::int FROM hosts WHERE verification_status = 'APPROVED') AS total_hosts,
                (SELECT COUNT(*)::int FROM hosts WHERE verification_status = 'PENDING') AS pending_hosts,
                (SELECT COUNT(*)::int FROM trips) AS total_trips,
                (SELECT COUNT(*)::int FROM trips WHERE status = 'pending') AS pending_trips,
                (SELECT COUNT(*)::int FROM trips WHERE status = 'published') AS published_trips,
                (SELECT COUNT(*)::int FROM trips WHERE status = 'completed') AS completed_trips,
                (SELECT COUNT(*)::int FROM bookings) AS total_bookings,
                (SELECT COALESCE(SUM(amount), 0)::numeric FROM bookings WHERE payment_status = 'paid') AS total_revenue
        `;

        const recentBookingsQuery = `
            SELECT 
                b.id AS booking_id,
                b.seats_booked,
                b.amount,
                b.booking_status,
                b.payment_status,
                b.joined_at,
                u.full_name AS traveler_name,
                u.email AS traveler_email,
                t.trip_name,
                t.destination
            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            JOIN trips t ON b.trip_id = t.id
            ORDER BY b.joined_at DESC
            LIMIT 5
        `;

        const recentHostsQuery = `
            SELECT 
                h.user_id,
                h.phone,
                h.city,
                h.experience,
                h.verification_status,
                h.created_at,
                u.full_name,
                u.email
            FROM hosts h
            JOIN users u ON h.user_id = u.id
            WHERE h.verification_status = 'PENDING'
            ORDER BY h.created_at DESC
            LIMIT 5
        `;

        const [statsRes, recentBookingsRes, recentHostsRes] = await Promise.all([
            pool.query(statsQuery),
            pool.query(recentBookingsQuery),
            pool.query(recentHostsQuery),
        ]);

        const stats = statsRes.rows[0] || {};

        return res.status(200).json({
            success: true,
            stats: {
                totalUsers: Number(stats.total_users || 0),
                totalHosts: Number(stats.total_hosts || 0),
                pendingHosts: Number(stats.pending_hosts || 0),
                totalTrips: Number(stats.total_trips || 0),
                pendingTrips: Number(stats.pending_trips || 0),
                publishedTrips: Number(stats.published_trips || 0),
                completedTrips: Number(stats.completed_trips || 0),
                totalBookings: Number(stats.total_bookings || 0),
                totalRevenue: Number(stats.total_revenue || 0),
            },
            recentBookings: recentBookingsRes.rows,
            recentHosts: recentHostsRes.rows,
        });
    } catch (error) {
        console.error("Get Admin Stats Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch admin stats.",
            error: error.message,
        });
    }
};

/* ====================================================
   Get Pending Host Applications
==================================================== */
export const getPendingHosts = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const hostsQuery = `
            SELECT
                h.user_id,
                h.phone,
                h.city,
                h.languages,
                h.bio,
                h.experience,
                h.reason,
                h.verification_status,
                h.rating,
                h.total_reviews,
                h.total_trips,
                h.created_at,
                u.full_name,
                u.email,
                u.profile_image
            FROM hosts h
            JOIN users u ON h.user_id = u.id
            WHERE h.verification_status = 'PENDING'
            ORDER BY h.created_at ASC
            LIMIT $1 OFFSET $2
        `;

        const countQuery = `
            SELECT COUNT(*) AS total
            FROM hosts
            WHERE verification_status = 'PENDING'
        `;

        const [hostsResult, countResult] = await Promise.all([
            pool.query(hostsQuery, [limit, offset]),
            pool.query(countQuery),
        ]);

        const total = Number(countResult.rows[0].total);

        return res.status(200).json({
            success: true,
            hosts: hostsResult.rows,
            totalHosts: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Get Pending Hosts Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch pending hosts.",
        });
    }
};

/* ====================================================
   Update Host Application Status
==================================================== */
export const updateHostStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { status } = req.body;

        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status.",
            });
        }

        const result = await pool.query(
            `
            UPDATE hosts
            SET verification_status = $1
            WHERE user_id = $2
            RETURNING *;
            `,
            [status, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Host application not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: `Host ${status.toLowerCase()} successfully.`,
            host: result.rows[0],
        });
    } catch (error) {
        console.error("Update Host Status Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error.",
        });
    }
};

/* ====================================================
   Get Pending Trips for Moderation
==================================================== */
export const getPendingTrips = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const tripsQuery = `
            SELECT 
                t.id,
                t.host_id,
                t.trip_name,
                t.trip_description,
                t.category,
                t.destination,
                t.start_location,
                t.start_date,
                t.end_date,
                t.price_per_person,
                t.travelers_limit,
                t.status,
                t.created_at,
                u.full_name AS host_name,
                u.email AS host_email,
                (SELECT image_url FROM trip_images WHERE trip_id = t.id AND is_cover = true LIMIT 1) AS cover_image
            FROM trips t
            JOIN users u ON t.host_id = u.id
            WHERE t.status = 'pending'
            ORDER BY t.created_at ASC
            LIMIT $1 OFFSET $2
        `;

        const countQuery = `SELECT COUNT(*) AS total FROM trips WHERE status = 'pending'`;

        const [tripsResult, countResult] = await Promise.all([
            pool.query(tripsQuery, [limit, offset]),
            pool.query(countQuery),
        ]);

        const total = Number(countResult.rows[0].total);

        return res.status(200).json({
            success: true,
            trips: tripsResult.rows,
            totalTrips: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Get Pending Trips Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch pending trips.",
            error: error.message,
        });
    }
};

/* ====================================================
   Update Trip Status (Approve/Publish or Reject)
==================================================== */
export const updateTripStatus = async (req, res) => {
    try {
        const { tripId } = req.params;
        const { status } = req.body;

        if (!["published", "cancelled", "rejected"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status value.",
            });
        }

        const result = await pool.query(
            `
            UPDATE trips
            SET status = $1
            WHERE id = $2
            RETURNING *;
            `,
            [status, tripId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Trip not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: `Trip status updated to ${status}.`,
            trip: result.rows[0],
        });
    } catch (error) {
        console.error("Update Trip Status Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update trip status.",
        });
    }
};

/* ====================================================
   Get All Users (Admin User Management)
==================================================== */
export const getAllUsers = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";

        let whereClause = "";
        const queryParams = [limit, offset];

        if (search) {
            queryParams.push(`%${search}%`);
            whereClause = `WHERE u.full_name ILIKE $3 OR u.email ILIKE $3 OR u.phone ILIKE $3`;
        }

        const usersQuery = `
            SELECT 
                u.id,
                u.full_name,
                u.email,
                u.phone,
                u.city,
                u.country,
                u.role,
                u.profile_image,
                u.created_at,
                (SELECT COUNT(*)::int FROM bookings WHERE traveler_id = u.id) AS bookings_count,
                (SELECT verification_status FROM hosts WHERE user_id = u.id LIMIT 1) AS host_status
            FROM users u
            ${whereClause}
            ORDER BY u.created_at DESC
            LIMIT $1 OFFSET $2
        `;

        const countQuery = `SELECT COUNT(*) AS total FROM users u ${whereClause}`;

        const [usersResult, countResult] = await Promise.all([
            pool.query(usersQuery, queryParams),
            pool.query(countQuery, search ? [`%${search}%`] : []),
        ]);

        const total = Number(countResult.rows[0].total);

        return res.status(200).json({
            success: true,
            users: usersResult.rows,
            totalUsers: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Get All Users Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch users.",
            error: error.message,
        });
    }
};

/* ====================================================
   Get All Bookings (Admin Booking Oversight)
==================================================== */
export const getAllBookings = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";
        const statusFilter = req.query.status || "";

        let whereConditions = [];
        const queryParams = [limit, offset];

        let countWhereConditions = [];
        const countParams = [];

        if (search) {
            queryParams.push(`%${search}%`);
            whereConditions.push(`(u.full_name ILIKE $${queryParams.length} OR u.email ILIKE $${queryParams.length} OR t.trip_name ILIKE $${queryParams.length})`);

            countParams.push(`%${search}%`);
            countWhereConditions.push(`(u.full_name ILIKE $${countParams.length} OR u.email ILIKE $${countParams.length} OR t.trip_name ILIKE $${countParams.length})`);
        }

        if (statusFilter) {
            queryParams.push(statusFilter);
            whereConditions.push(`b.booking_status = $${queryParams.length}`);

            countParams.push(statusFilter);
            countWhereConditions.push(`b.booking_status = $${countParams.length}`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
        const countWhereClause = countWhereConditions.length > 0 ? `WHERE ${countWhereConditions.join(" AND ")}` : "";

        const bookingsQuery = `
            SELECT 
                b.id AS booking_id,
                b.seats_booked,
                b.amount,
                b.booking_status,
                b.payment_status,
                b.phone,
                b.emergency_name,
                b.emergency_phone,
                b.joined_at,
                u.id AS traveler_id,
                u.full_name AS traveler_name,
                u.email AS traveler_email,
                t.id AS trip_id,
                t.trip_name,
                t.destination
            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            JOIN trips t ON b.trip_id = t.id
            ${whereClause}
            ORDER BY b.joined_at DESC
            LIMIT $1 OFFSET $2
        `;

        const countQuery = `
            SELECT COUNT(*) AS total 
            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            JOIN trips t ON b.trip_id = t.id
            ${countWhereClause}
        `;

        const [bookingsResult, countResult] = await Promise.all([
            pool.query(bookingsQuery, queryParams),
            pool.query(countQuery, countParams),
        ]);

        const total = Number(countResult.rows[0].total);

        return res.status(200).json({
            success: true,
            bookings: bookingsResult.rows,
            totalBookings: total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Get All Bookings Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bookings.",
            error: error.message,
        });
    }
};

/* ====================================================
   Get Admin Payment Logs & Stats
==================================================== */
export const getAdminPayments = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";
        const statusFilter = req.query.status || "";

        let whereConditions = [];
        const queryParams = [limit, offset];

        let countWhereConditions = [];
        const countParams = [];

        if (search) {
            queryParams.push(`%${search}%`);
            whereConditions.push(`(u.full_name ILIKE $${queryParams.length} OR u.email ILIKE $${queryParams.length} OR t.trip_name ILIKE $${queryParams.length})`);

            countParams.push(`%${search}%`);
            countWhereConditions.push(`(u.full_name ILIKE $${countParams.length} OR u.email ILIKE $${countParams.length} OR t.trip_name ILIKE $${countParams.length})`);
        }

        if (statusFilter) {
            queryParams.push(statusFilter);
            whereConditions.push(`b.payment_status = $${queryParams.length}`);

            countParams.push(statusFilter);
            countWhereConditions.push(`b.payment_status = $${countParams.length}`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
        const countWhereClause = countWhereConditions.length > 0 ? `WHERE ${countWhereConditions.join(" AND ")}` : "";

        const paymentsQuery = `
            SELECT 
                b.id AS booking_id,
                b.amount,
                b.payment_status,
                b.booking_status,
                b.joined_at,
                u.full_name AS traveler_name,
                u.email AS traveler_email,
                t.trip_name
            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            JOIN trips t ON b.trip_id = t.id
            ${whereClause}
            ORDER BY b.joined_at DESC
            LIMIT $1 OFFSET $2
        `;

        const statsQuery = `
            SELECT 
                (SELECT COALESCE(SUM(amount), 0)::numeric FROM bookings WHERE payment_status = 'paid') AS total_paid_revenue,
                (SELECT COUNT(*)::int FROM bookings WHERE payment_status = 'paid') AS total_paid_count,
                (SELECT COUNT(*)::int FROM bookings WHERE payment_status = 'pending') AS total_pending_count,
                (SELECT COUNT(*)::int FROM bookings WHERE booking_status = 'cancelled') AS total_cancelled_count
        `;

        const countQuery = `
            SELECT COUNT(*) AS total 
            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            JOIN trips t ON b.trip_id = t.id
            ${countWhereClause}
        `;

        const [paymentsResult, statsResult, countResult] = await Promise.all([
            pool.query(paymentsQuery, queryParams),
            pool.query(statsQuery),
            pool.query(countQuery, countParams),
        ]);

        const total = Number(countResult.rows[0].total);
        const stats = statsResult.rows[0] || {};

        return res.status(200).json({
            success: true,
            payments: paymentsResult.rows,
            totalPayments: total,
            stats: {
                totalPaidRevenue: Number(stats.total_paid_revenue || 0),
                totalPaidCount: Number(stats.total_paid_count || 0),
                totalPendingCount: Number(stats.total_pending_count || 0),
                totalCancelledCount: Number(stats.total_cancelled_count || 0),
            },
            currentPage: page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Get Admin Payments Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch admin payment records.",
            error: error.message,
        });
    }
};