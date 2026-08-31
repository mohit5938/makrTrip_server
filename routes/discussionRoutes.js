import express from "express";
import {
    checkUserTripAccess,
    getTripDiscussions,
    postDiscussionMessage,
    deleteDiscussionMessage,
} from "../controller/discussionController.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const discussionRouter = express.Router();

// Check user room access (host/joined traveler)
discussionRouter.get("/access/:tripId", isAuthenticated, checkUserTripAccess);

// Get trip discussions (public preview)
discussionRouter.get("/:tripId", getTripDiscussions);

// Post discussion message (joined traveler/host only)
discussionRouter.post("/", isAuthenticated, postDiscussionMessage);

// Delete discussion message
discussionRouter.delete("/:id", isAuthenticated, deleteDiscussionMessage);

export default discussionRouter;
