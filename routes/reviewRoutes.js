import express from "express";
import {
    createReview,
    getTripReviews,
    getUserReviewableTrips
} from "../controller/reviewController.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const reviewRouter = express.Router();

// Public: Get Reviews for a Trip
reviewRouter.get("/trip/:tripId", getTripReviews);

// Protected: Submit / Update a Review
reviewRouter.post("/", isAuthenticated, createReview);

// Protected: Get User Reviewable Trips
reviewRouter.get("/reviewable", isAuthenticated, getUserReviewableTrips);

export default reviewRouter;
