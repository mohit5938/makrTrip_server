import express from "express";
import {
    getAdminStats,
    getPendingHosts,
    updateHostStatus,
    getPendingTrips,
    updateTripStatus,
    getAllUsers,
    getAllBookings,
    getAdminPayments
} from "../controller/adminController.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";
import { isAdmin } from "../middleware/isAdmin.js";

const adminRouter = express.Router();

// Middleware: All routes require Auth + Admin Role
adminRouter.use(isAuthenticated, isAdmin);

// Stats Overview
adminRouter.get("/stats", getAdminStats);

// Host Moderation
adminRouter.get("/pending-hosts", getPendingHosts);
adminRouter.patch("/hosts/:userId/status", updateHostStatus);

// Trip Moderation
adminRouter.get("/pending-trips", getPendingTrips);
adminRouter.patch("/trips/:tripId/status", updateTripStatus);

// User, Booking & Payment Management
adminRouter.get("/users", getAllUsers);
adminRouter.get("/bookings", getAllBookings);
adminRouter.get("/payments", getAdminPayments);

export default adminRouter;