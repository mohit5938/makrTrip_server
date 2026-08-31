import pool from "../config/dbConfig.js";

export const joinTrip = async (req, res) => {

    const client = await pool.connect();

    try {
        const { tripId } = req.params;
        const travelerId = req.userId;
    
        const {
         phone, emergencyName, emergencyPhone, specialRequest,
        } = req.body || {};

        if (!tripId) {

            return res.status(400).json({
                success: false,
                message: "Trip id is required.",
            });

        }

        if (!phone?.trim()) {

            return res.status(400).json({
                success: false,
                message: "Phone number is required.",

            });

        }

        if (!emergencyName?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Emergency contact name is required.",
            });
        }

        if (!emergencyPhone?.trim()) {
            return res.status(400).json({
                success: false,
             message: "Emergency contact phone is required.",
            });

        }

        const cleanPhone = (phone || "").replace(/\D/g, "").slice(-10);
        const cleanEmergencyPhone = (emergencyPhone || "").replace(/\D/g, "").slice(-10);

        const phoneRegex = /^[6-9]\d{9}$/;

        if (!phoneRegex.test(cleanPhone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit phone number.",
            });
        }

        if (!phoneRegex.test(cleanEmergencyPhone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid 10-digit emergency contact phone number.",
            });
        }

        /* ----------------------------------
            Start Transaction
        ----------------------------------- */
        const now = new Date();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await client.query("BEGIN");

        /* ----------------------------------
            Lock Trip Row
        ----------------------------------- */

        const tripResult = await client.query(

            `
            SELECT

                id,
                host_id,
               
                status,
                start_date,
                travelers_limit,
                current_bookings,
                price_per_person

            FROM trips

            WHERE id = $1
            FOR UPDATE
            `,

            [tripId]

        );

        if (tripResult.rows.length === 0) {

            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Trip not found.",
            });

        }

        const trip = tripResult.rows[0];

        /* ----------------------------------
    Trip Status Validation
         ----------------------------------- */

        if (trip.status !== "published") {

            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "This trip is not available for booking.",
            });
        }

        /* ----------------------------------
            Booking Closed?
        ----------------------------------- */

      

        if (new Date(trip.start_date) <= now) {

            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Booking is closed because the trip has already started.",
            });
        }

        /* ----------------------------------
            Host Cannot Join Own Trip
        ----------------------------------- */

        // if (trip.host_id === travelerId) {
        //     await client.query("ROLLBACK");
        //     return res.status(403).json({
        //         success: false,
        //         message: "You cannot join your own trip.",

        //     });
        // }

        /* ----------------------------------
            Existing Active Booking
        ----------------------------------- */

        const existingBooking = await client.query(
            `
SELECT
    id,
    booking_status,
    payment_status
FROM bookings
WHERE
    trip_id = $1
    AND traveler_id = $2
LIMIT 1
`,
            [tripId, travelerId]
        );

        if (existingBooking.rows.length > 0) {

            const booking = existingBooking.rows[0];

            // Already paid / confirmed
            if (
                ["approved", "confirmed", "completed"].includes(
                    booking.booking_status
                )
            ) {

                await client.query("ROLLBACK");

                return res.status(409).json({
                    success: false,
                    message: "You have already joined this trip.",
                });

            }

            // Payment still pending
            if (booking.booking_status === "pending") {

                await client.query("ROLLBACK");

                return res.status(200).json({
                    success: true,
                    message: "Complete your existing payment.",
                    booking: {
                        id: booking.id
                    }
                });

            }
            if (trip.current_bookings >= trip.travelers_limit) {

                await client.query("ROLLBACK");

                return res.status(400).json({
                    success: false,
                    message: "No seats available.",
                });

            }
            // Expired / Cancelled booking
            if (booking.booking_status === "cancelled") {
                console.log("Entered cancelled block");

                const updatedBooking = await client.query(
                    `
            UPDATE bookings
            SET
                booking_status = 'pending',
                payment_status = 'pending',

                joined_at = NOW(),
                updated_at = NOW(),

                cancelled_at = NULL,
                cancellation_reason = NULL,

                expires_at = $6,

                phone = $1,
                emergency_name = $2,
                emergency_phone = $3,
                special_request = $4

            WHERE id = $5

            RETURNING
                id,
                trip_id,
                traveler_id,
                amount,
                booking_status,
                payment_status,
                expires_at
            `,
                    [
                        phone.trim(),
                        emergencyName.trim(),
                        emergencyPhone.trim(),
                        specialRequest?.trim() || null,
                        booking.id,
                        expiresAt
                    ]
                );
                console.log("Rows updated:", updatedBooking.rowCount);
                console.log(updatedBooking.rows[0]);

                // Reserve the seat again
                await client.query(
                    `
            UPDATE trips
            SET current_bookings = current_bookings + 1
            WHERE id = $1
            `,
                    [tripId]
                );

                await client.query("COMMIT");

                return res.status(200).json({
                    success: true,
                    message: "Booking reactivated successfully.",
                    booking: updatedBooking.rows[0],
                    nextStep: "payment"
                });

            }

        }

        /* ----------------------------------
            Seat Availability
        ----------------------------------- */

        if ( trip.current_bookings >= trip.travelers_limit ) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "No seats available.",
            });
        }

        /* ----------------------------------
            Booking Defaults
        ----------------------------------- */

        const bookingStatus = "pending";

        const paymentStatus = "pending";
        /* ----------------------------------
                     Create Booking
        ----------------------------------- */
         
        const bookingResult = await client.query(
 
            `
            INSERT INTO bookings (

                trip_id,
                traveler_id,
                seats_booked,
                amount,
                booking_status,
                payment_status,
                expires_at,
                phone,
                emergency_name,
                emergency_phone,
                special_request,
                joined_at
            )

         VALUES (
    $1, $2, $3, $4, $5, $6,

    $7,

    $8, $9, $10, $11, NOW()
)

            RETURNING
                id,
                trip_id,
                traveler_id,
                amount,
                booking_status,
                payment_status,
                expires_at,
                created_at
            `,

            [
                tripId,
                travelerId,
                1,
                trip.price_per_person,
                bookingStatus,
                paymentStatus,
                expiresAt,                      // $7
                phone.trim(),                   // $8
                emergencyName.trim(),           // $9
                emergencyPhone.trim(),          // $10
                specialRequest?.trim() || null, // $11
            ]

        );

        await client.query(
            `
    UPDATE trips
    SET current_bookings = current_bookings + 1
    WHERE id = $1
    `,
            [tripId]
        );

        /* ----------------------------------
        Commit Transaction
        ----------------------------------- */
        
        const booking = bookingResult.rows[0];
        await client.query("COMMIT");
        return res.status(201).json({
            success: true,
            message: "Booking created successfully. Complete your payment within 15 minutes..",
            booking,
            nextStep: "payment",

        });
    }
    catch (error) {
        await client.query("ROLLBACK");

        return res.status(500).json({
            success: false,
            message: "An error occurred while processing your booking.",
            error: error.message,
        });
    }
    finally {
        client.release();
    }

}
    


export const getBookingDetails = async (req, res) => {
    try {

        const { bookingId } = req.params;

        const travelerId = req.userId;

        const query = `
            SELECT

                b.id,
                b.amount,
                b.booking_status,
                b.payment_status,
                b.joined_at,
                b.expires_at,

                b.phone,
                b.emergency_name,
                b.emergency_phone,
                b.special_request,

                t.id AS trip_id,
                t.trip_name,
                t.destination,
                t.start_date,
                t.end_date,
               
                t.category,
                t.price_per_person,

                u.id AS host_id,
                u.full_name AS host_name,
             
                tr.id AS traveler_id,
                tr.full_name AS traveler_name,
                tr.email AS traveler_email
            FROM bookings b

            JOIN trips t
            ON b.trip_id = t.id

            JOIN users u
            ON t.host_id = u.id

            JOIN users tr
            ON b.traveler_id = tr.id

            WHERE
                b.id = $1
                AND b.traveler_id = $2

            LIMIT 1;
        `;

        const { rows } = await pool.query(query, [
            bookingId,
            travelerId,
        ]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found."
            });
        }

        console.log(rows[0]);
        const row = rows[0];

        const booking = {

            id: row.id,
            amount: row.amount,
            booking_status: row.booking_status,
            payment_status: row.payment_status,
            joined_at: row.joined_at,
            expires_at: row.expires_at,

            phone: row.phone,
            emergency_name: row.emergency_name,
            emergency_phone: row.emergency_phone,
            special_request: row.special_request,

            traveler: {
                id: row.traveler_id,
                name: row.traveler_name,
                email: row.traveler_email,
            },

            host: {
                id: row.host_id,
                name: row.host_name,
              
            },

            trip: {
                id: row.trip_id,
                name: row.trip_name,
                destination: row.destination,
                start_date: row.start_date,
                end_date: row.end_date,
               
                category: row.category,
                price_per_person: row.price_per_person,
            }

        };

        return res.status(200).json({
            success: true,
            booking,
        });
     

    } catch (error) {

        console.error("Get Booking Details Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch booking details.",
            error: error.message
        });

    }
};

/* ----------------------------------
    Get All User Bookings
----------------------------------- */
export const getUserBookings = async (req, res) => {
    try {
        const travelerId = req.userId;

        const query = `
            SELECT
                b.id AS booking_id,
                b.amount,
                b.seats_booked,
                b.booking_status,
                b.payment_status,
                b.joined_at,
                b.expires_at,
                b.cancelled_at,
                b.cancellation_reason,
                b.phone,
                b.emergency_name,
                b.emergency_phone,
                b.special_request,

                t.id AS trip_id,
                t.trip_name,
                t.destination,
                t.start_location,
                t.start_date,
                t.end_date,
                t.category,
                t.price_per_person,
                t.status AS trip_status,

                u.id AS host_id,
                u.full_name AS host_name,
                u.email AS host_email,
                u.profile_image AS host_photo,

                (
                    SELECT image_url
                    FROM trip_images ti
                    WHERE ti.trip_id = t.id
                    ORDER BY ti.is_cover DESC NULLS LAST, ti.id ASC
                    LIMIT 1
                ) AS cover_image

            FROM bookings b
            JOIN trips t ON b.trip_id = t.id
            JOIN users u ON t.host_id = u.id
            WHERE b.traveler_id = $1
            ORDER BY b.joined_at DESC;
        `;

        const { rows } = await pool.query(query, [travelerId]);

        const bookings = rows.map((row) => {
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
                id: row.booking_id,
                amount: row.amount,
                seatsBooked: row.seats_booked,
                bookingStatus: row.booking_status,
                paymentStatus: row.payment_status,
                joinedAt: row.joined_at,
                expiresAt: row.expires_at,
                cancelledAt: row.cancelled_at,
                cancellationReason: row.cancellation_reason,
                phone: row.phone,
                emergencyName: row.emergency_name,
                emergencyPhone: row.emergency_phone,
                specialRequest: row.special_request,
                trip: {
                    id: row.trip_id,
                    name: row.trip_name,
                    destination: parsedDestination,
                    startLocation: parsedStartLocation,
                    startDate: row.start_date,
                    endDate: row.end_date,
                    category: row.category,
                    pricePerPerson: row.price_per_person,
                    status: row.trip_status,
                    coverImage: row.cover_image || null
                },
                host: {
                    id: row.host_id,
                    name: row.host_name,
                    email: row.host_email,
                    photo: row.host_photo || null
                }
            };
        });

        return res.status(200).json({
            success: true,
            count: bookings.length,
            bookings
        });
    } catch (error) {
        console.error("Get User Bookings Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch your bookings.",
            error: error.message
        });
    }
};

/* ----------------------------------
    Cancel Booking
----------------------------------- */
export const cancelBooking = async (req, res) => {
    const client = await pool.connect();
    try {
        const { bookingId } = req.params;
        const travelerId = req.userId;
        const { cancellationReason } = req.body || {};

        if (!bookingId) {
            return res.status(400).json({
                success: false,
                message: "Booking ID is required."
            });
        }

        await client.query("BEGIN");

        const bookingResult = await client.query(
            `
            SELECT b.id, b.trip_id, b.booking_status, t.start_date
            FROM bookings b
            JOIN trips t ON b.trip_id = t.id
            WHERE b.id = $1 AND b.traveler_id = $2
            FOR UPDATE
            `,
            [bookingId, travelerId]
        );

        if (bookingResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Booking not found."
            });
        }

        const booking = bookingResult.rows[0];

        if (booking.booking_status === "cancelled") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "This booking is already cancelled."
            });
        }

        const now = new Date();
        if (new Date(booking.start_date) <= now) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Cannot cancel booking for a trip that has already started."
            });
        }

        const updatedBooking = await client.query(
            `
            UPDATE bookings
            SET
                booking_status = 'cancelled',
                payment_status = CASE WHEN payment_status = 'paid' THEN 'refund_pending' ELSE 'failed' END,
                cancelled_at = NOW(),
                cancellation_reason = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING id, booking_status, payment_status, cancelled_at
            `,
            [cancellationReason?.trim() || "Cancelled by user", bookingId]
        );

        await client.query(
            `
            UPDATE trips
            SET current_bookings = GREATEST(current_bookings - 1, 0)
            WHERE id = $1
            `,
            [booking.trip_id]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Booking cancelled successfully.",
            booking: updatedBooking.rows[0]
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Cancel Booking Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel booking.",
            error: error.message
        });
    } finally {
        client.release();
    }
};

/* ----------------------------------
    Process Payment & Confirm Booking
----------------------------------- */
export const processPayment = async (req, res) => {
    const client = await pool.connect();
    try {
        const { bookingId } = req.params;
        const travelerId = req.userId;
        const { paymentMethod = "Card", transactionId } = req.body || {};

        if (!bookingId) {
            return res.status(400).json({
                success: false,
                message: "Booking ID is required."
            });
        }

        await client.query("BEGIN");

        const bookingResult = await client.query(
            `
            SELECT b.id, b.trip_id, b.booking_status, b.payment_status, b.expires_at, t.trip_name, t.start_date
            FROM bookings b
            JOIN trips t ON b.trip_id = t.id
            WHERE b.id = $1 AND b.traveler_id = $2
            FOR UPDATE
            `,
            [bookingId, travelerId]
        );

        if (bookingResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Booking not found."
            });
        }

        const booking = bookingResult.rows[0];

        if (booking.payment_status === "paid" || booking.booking_status === "confirmed") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "This booking is already paid and confirmed."
            });
        }

        if (booking.booking_status === "cancelled") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Cannot pay for a cancelled booking."
            });
        }

        const now = new Date();
        if (booking.expires_at && new Date(booking.expires_at) <= now) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Payment time window expired. Booking cancelled."
            });
        }

        const generatedTxnId = transactionId || `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

        const updatedBooking = await client.query(
            `
            UPDATE bookings
            SET
                booking_status = 'confirmed',
                payment_status = 'paid',
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, booking_status, payment_status, amount, trip_id, joined_at
            `,
            [bookingId]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Payment successful! Your booking is now confirmed.",
            booking: updatedBooking.rows[0],
            transaction: {
                transactionId: generatedTxnId,
                paymentMethod,
                paidAt: new Date().toISOString()
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Process Payment Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to process payment.",
            error: error.message
        });
    } finally {
        client.release();
    }
};


    