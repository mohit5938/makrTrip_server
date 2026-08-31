import pool from "../config/dbConfig.js";

export const applyForHost = async (req, res) => {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        const userId = req.userId;

        const {
            phone,
            experience,
            city,
            languages,
            bio,
            reason
        } = req.body;

        // Check if user already applied

        const existingApplication = await client.query(
            `SELECT verification_status
             FROM hosts
             WHERE user_id = $1`,
            [userId]
        );

        if (existingApplication.rows.length > 0) {

            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "You have already applied to become a host."
            });

        }

        // Insert application

        await client.query(

            `INSERT INTO hosts
            (
                user_id,
                phone,
                experience,
                city,
                languages,
                bio,
                reason,
                verification_status
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,'PENDING'
            )`,

            [
                userId,
                phone,
                experience,
                city,
                languages,
                bio,
                reason
            ]

        );

        await client.query("COMMIT");

        return res.status(201).json({

            success: true,

            message: "Your host application has been submitted successfully."

        });

    }

    catch (error) {

        await client.query("ROLLBACK");

        console.log(error);

        return res.status(500).json({

            success: false,

            message: "Internal Server Error"

        });

    }

    finally {

        client.release();

    }

};



// controllers/hostController.js

export const getHostStatus = async (req, res) => {

    try {

        const result = await pool.query(

            `SELECT verification_status
             FROM hosts
             WHERE user_id=$1`,

            [req.userId]

        );

        if (result.rows.length === 0) {

            return res.json({

                success: true,

                isHost: false,

                status: null

            });

        }

        return res.json({

            success: true,

            isHost: true,

            status: result.rows[0].verification_status

        });

    }

    catch (error) {

        console.log(error);

        res.status(500).json({

            success: false,

            message: "Internal Server Error"

        });

    }

};

/* ----------------------------------
    Get My Hosted Trips (Host Dashboard)
----------------------------------- */
export const getMyHostedTrips = async (req, res) => {
    try {
        const hostId = req.userId;

        const query = `
            SELECT
                t.id,
                t.trip_name,
                t.trip_description,
                t.category,
                t.destination,
                t.start_location,
                t.start_date,
                t.end_date,
                t.price_per_person,
                t.travelers_limit,
                t.current_bookings,
                t.status,
                t.created_at,

                (
                    SELECT image_url
                    FROM trip_images ti
                    WHERE ti.trip_id = t.id
                    ORDER BY ti.is_cover DESC NULLS LAST, ti.id ASC
                    LIMIT 1
                ) AS cover_image,

                (
                    SELECT COUNT(*)::int
                    FROM bookings b
                    WHERE b.trip_id = t.id
                    AND b.booking_status IN ('confirmed', 'approved', 'completed')
                ) AS confirmed_bookings_count,

                (
                    SELECT COALESCE(SUM(b.amount), 0)::numeric
                    FROM bookings b
                    WHERE b.trip_id = t.id
                    AND b.payment_status = 'paid'
                ) AS total_revenue

            FROM trips t
            WHERE t.host_id = $1
            ORDER BY t.created_at DESC;
        `;

        const { rows } = await pool.query(query, [hostId]);

        const trips = rows.map((row) => {
            let parsedDestination = row.destination;
            let parsedStartLocation = row.start_location;

            if (typeof row.destination === "string") {
                try {
                    parsedDestination = JSON.parse(row.destination);
                } catch (e) {}
            }

            if (typeof row.start_location === "string") {
                try {
                    parsedStartLocation = JSON.parse(row.start_location);
                } catch (e) {}
            }

            return {
                id: row.id,
                name: row.trip_name,
                description: row.trip_description,
                category: row.category,
                destination: parsedDestination,
                startLocation: parsedStartLocation,
                startDate: row.start_date,
                endDate: row.end_date,
                pricePerPerson: Number(row.price_per_person || 0),
                travelersLimit: Number(row.travelers_limit || 0),
                currentBookings: Number(row.current_bookings || 0),
                confirmedBookingsCount: Number(row.confirmed_bookings_count || 0),
                totalRevenue: Number(row.total_revenue || 0),
                status: row.status,
                createdAt: row.created_at,
                coverImage: row.cover_image || null
            };
        });

        return res.status(200).json({
            success: true,
            count: trips.length,
            trips
        });
    } catch (error) {
        console.error("Get My Hosted Trips Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch hosted trips.",
            error: error.message
        });
    }
};

/* ----------------------------------
    Get Traveler Roster for a Hosted Trip
----------------------------------- */
export const getTripTravelers = async (req, res) => {
    try {
        const hostId = req.userId;
        const { tripId } = req.params;

        const tripCheck = await pool.query(
            `SELECT id, trip_name FROM trips WHERE id = $1 AND host_id = $2`,
            [tripId, hostId]
        );

        if (tripCheck.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view travelers for this trip."
            });
        }

        const query = `
            SELECT
                b.id AS booking_id,
                b.amount,
                b.seats_booked,
                b.booking_status,
                b.payment_status,
                b.joined_at,
                b.phone,
                b.emergency_name,
                b.emergency_phone,
                b.special_request,

                u.id AS traveler_id,
                u.full_name AS traveler_name,
                u.email AS traveler_email,
                u.profile_image AS traveler_photo

            FROM bookings b
            JOIN users u ON b.traveler_id = u.id
            WHERE b.trip_id = $1
            ORDER BY b.joined_at DESC;
        `;

        const { rows } = await pool.query(query, [tripId]);

        const travelers = rows.map((row) => ({
            bookingId: row.booking_id,
            travelerId: row.traveler_id,
            name: row.traveler_name,
            email: row.traveler_email,
            photo: row.traveler_photo || null,
            phone: row.phone,
            emergencyName: row.emergency_name,
            emergencyPhone: row.emergency_phone,
            specialRequest: row.special_request,
            amount: row.amount,
            seatsBooked: row.seats_booked,
            bookingStatus: row.booking_status,
            paymentStatus: row.payment_status,
            joinedAt: row.joined_at
        }));

        return res.status(200).json({
            success: true,
            tripName: tripCheck.rows[0].trip_name,
            count: travelers.length,
            travelers
        });
    } catch (error) {
        console.error("Get Trip Travelers Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch traveler roster.",
            error: error.message
        });
    }
};

/* ----------------------------------
    Update Hosted Trip Status
----------------------------------- */
export const updateHostedTripStatus = async (req, res) => {
    try {
        const hostId = req.userId;
        const { tripId } = req.params;
        const { status } = req.body;

        const allowedStatuses = ["completed", "cancelled"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status update. Allowed: completed, cancelled."
            });
        }

        const updateResult = await pool.query(
            `
            UPDATE trips
            SET status = $1
            WHERE id = $2 AND host_id = $3
            RETURNING id, trip_name, status
            `,
            [status, tripId, hostId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Trip not found or unauthorized."
            });
        }

        return res.status(200).json({
            success: true,
            message: `Trip status updated to ${status}.`,
            trip: updateResult.rows[0]
        });
    } catch (error) {
        console.error("Update Hosted Trip Status Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update trip status.",
            error: error.message
        });
    }
};