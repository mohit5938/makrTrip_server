import express from "express";
import {
    applyForHost,
    getHostStatus,
    getMyHostedTrips,
    getTripTravelers,
    updateHostedTripStatus
} from "../controller/hostController.js";
import { isAuthenticated } from '../middleware/authMiddleware.js';

const hostRouter = express.Router();
hostRouter.get("/status", isAuthenticated, getHostStatus);
hostRouter.post("/apply", isAuthenticated, applyForHost);
hostRouter.get("/my-hosted-trips", isAuthenticated, getMyHostedTrips);
hostRouter.get("/trip-travelers/:tripId", isAuthenticated, getTripTravelers);
hostRouter.patch("/update-trip-status/:tripId", isAuthenticated, updateHostedTripStatus);

export default hostRouter;