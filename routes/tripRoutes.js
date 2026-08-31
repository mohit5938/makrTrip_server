import express from "express";
import {
    searchDestination, createTrip , getPendingTrips,
    approveTrip, rejectTrip, getTopDestinations,
     getAllTrips, getTripById
} from "../controller/tripController.js";

import upload from "../middleware/multer.js";
import { isAuthenticated } from '../middleware/authMiddleware.js';
const tripRouter = express.Router();

    tripRouter.get("/search-destination",searchDestination);
        tripRouter.post("/create-trip", isAuthenticated,
     upload.array("tripImages",10), createTrip);

    tripRouter.get("/pending-trips", isAuthenticated, getPendingTrips);
    tripRouter.patch("/approve-trip/:id", isAuthenticated, approveTrip);
    tripRouter.patch("/reject-trip/:id", isAuthenticated, rejectTrip);
    tripRouter.get("/top-destinations", getTopDestinations);
    tripRouter.get("/all-trips", getAllTrips);
    tripRouter.get("/getTripById/:tripId", getTripById);
export default tripRouter;