import express from "express";
import {
    toggleWishlist,
    getUserWishlist,
    getUserWishlistIds,
} from "../controller/wishlistController.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const wishlistRouter = express.Router();

// All routes require authentication
wishlistRouter.post("/toggle", isAuthenticated, toggleWishlist);
wishlistRouter.get("/", isAuthenticated, getUserWishlist);
wishlistRouter.get("/ids", isAuthenticated, getUserWishlistIds);

export default wishlistRouter;
