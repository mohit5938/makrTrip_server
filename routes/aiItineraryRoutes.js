import express from "express";
import {
    generateAIItinerary,
    saveTripItinerary,
    getTripItinerary,
} from "../controller/aiItineraryController.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const aiItineraryRouter = express.Router();

// Generate AI Itinerary (Public / Travelers / Hosts)
aiItineraryRouter.post("/generate-itinerary", generateAIItinerary);

// Save Trip Itinerary (Protected Host Endpoint)
aiItineraryRouter.post("/save-itinerary", isAuthenticated, saveTripItinerary);

// Get Trip Itinerary (Public Endpoint)
aiItineraryRouter.get("/itinerary/:tripId", getTripItinerary);

export default aiItineraryRouter;
