import jwt from "jsonwebtoken";

export const isAuthenticated = async (req, res, next) => {
    try {

        let token = req.cookies?.token;
        if (!token && req.headers?.authorization?.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authorized",
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.userId = decoded.id;
        console.log("Authenticated User:", req.userId);

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid token",
        });
    }
}; 