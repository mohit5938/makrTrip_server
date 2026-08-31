import express from "express";
import { isAuthenticated } from '../middleware/authMiddleware.js';
import {
    joinTrip,
    getBookingDetails,
    getUserBookings,
    cancelBooking,
    processPayment
} from "../controller/bookingController.js";

const bookingRouter = express.Router();

bookingRouter.post("/join/:tripId", isAuthenticated, joinTrip);
bookingRouter.get("/my-bookings", isAuthenticated, getUserBookings);
bookingRouter.post("/cancel/:bookingId", isAuthenticated, cancelBooking);
bookingRouter.post("/payment/:bookingId", isAuthenticated, processPayment);
bookingRouter.get("/:bookingId", isAuthenticated, getBookingDetails);

export default bookingRouter;