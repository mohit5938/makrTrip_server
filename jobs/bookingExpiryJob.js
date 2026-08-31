import cron from "node-cron";
export const startBookingExpiryJob = () => {
    cron.schedule("* * * * *", async () => {

        let client;

        try {
            console.log("Running Booking Expiry Job...");

            client = await pool.connect();

            await client.query("BEGIN");

            const expiredBookings = await client.query(`
                UPDATE bookings
                SET
                    booking_status = 'cancelled',
                    payment_status = 'failed',
                    cancelled_at = NOW(),
                    cancellation_reason = 'Payment timeout',
                    updated_at = NOW()
                WHERE
                    booking_status = 'pending'
                    AND payment_status = 'pending'
                    AND expires_at <= NOW()
                RETURNING
                    id,
                    trip_id,
                    traveler_id
            `);

            for (const booking of expiredBookings.rows) {
                await client.query(
                    `
                    UPDATE trips
                    SET current_bookings = GREATEST(current_bookings - 1, 0)
                    WHERE id = $1
                    `,
                    [booking.trip_id]
                );
            }

            await client.query("COMMIT");

            if (expiredBookings.rows.length > 0) {
                console.log(
                    "Expired Bookings:",
                    expiredBookings.rows.map(b => b.id)
                );
            }

        } catch (error) {
            if (client) {
                try {
                    await client.query("ROLLBACK");
                } catch { }
            }

            console.error("Booking Expiry Job Failed:", error);

        } finally {
            if (client) {
                client.release();
            }
        }
    });
};