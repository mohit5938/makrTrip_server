import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import "./config/dbConfig.js";
import { startBookingExpiryJob } from "./jobs/bookingExpiryJob.js";
import cookieParser from "cookie-parser";
import userRouter from "./routes/authRoutes.js";
import tripRouter from "./routes/tripRoutes.js";
import hostRouter from "./routes/hostRoutes.js";
import adminRouter from "./routes/adminRoutes.js";
import bookingRouter from "./routes/bookingRoutes.js";
import reviewRouter from "./routes/reviewRoutes.js";
import wishlistRouter from "./routes/wishlistRoutes.js";
import aiItineraryRouter from "./routes/aiItineraryRoutes.js";
import discussionRouter from "./routes/discussionRoutes.js";



const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const FrontendURL = process.env.FRONTEND_URL ;
// Setup Socket.io for Real-Time Room Chat
const io = new Server(server, {
    cors: {
        origin: FrontendURL,
        credentials: true,
    },
});

io.on("connection", (socket) => {
    // Traveler / Host joins specific trip room
    socket.on("join_room", ({ tripId, userId }) => {
        if (tripId) {
            const roomName = `trip_room_${tripId}`;
            socket.join(roomName);
        }
    });

    socket.on("leave_room", ({ tripId }) => {
        if (tripId) {
            socket.leave(`trip_room_${tripId}`);
        }
    });
});

app.set("io", io);

app.use(express.json());
app.use(cookieParser());

app.use(cors({
    origin: FrontendURL,
    credentials: true,
}));

app.use((req, res, next) => {
    req.url = req.url.replace(/\/{2,}/g, '/');
    next();
});

app.use('/api/user', userRouter);
app.use('/api/trip', tripRouter);
app.use('/api/booking', bookingRouter);

app.use("/api/hosts", hostRouter);
app.use("/api/admin", adminRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/ai", aiItineraryRouter);
app.use("/api/discussions", discussionRouter);

server.listen(PORT, () => {
    console.log(`Server & WebSocket running on port ${PORT}`);
startBookingExpiryJob();
});
