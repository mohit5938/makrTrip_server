import pool from "../config/dbConfig.js";

export const isAdmin = async (req, res, next) => {

    try {

        const userId = req.userId;

        const result = await pool.query(
            `
            SELECT role
            FROM users
            WHERE id = $1
            `,
            [userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        if (result.rows[0].role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin only."
            });
        }

     
        next();

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error."
        });

    }

};