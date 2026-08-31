import express from "express";
import { isAuthenticated } from "../middleware/authMiddleware.js";
import upload from "../middleware/multer.js";

import {
    signup,
    signin,
    sendLoginOtp,
    verifyLoginOtp,
    forgotPassword,
    verifyResetOtp,
    resetPassword,
    googleLogin,
    logout,
    getUserProfile,
    updateUserProfile
} from "../controller/userController.js";

const userRouter = express.Router();


// ==============================
// Authentication & Profile Routes
// ==============================

// Register User
userRouter.post("/signup", signup);

// Login with Email & Password
userRouter.post("/signin", signin);

// Send Login OTP
userRouter.post("/send-login-otp", sendLoginOtp);

// Verify Login OTP
userRouter.post("/verify-login-otp", verifyLoginOtp);

// Forgot Password
userRouter.post("/forgot-password", forgotPassword);

// Verify Reset OTP
userRouter.post("/verify-reset-otp", verifyResetOtp);

// Reset Password
userRouter.post("/reset-password", resetPassword);

// google login 
userRouter.post("/google-login", googleLogin );

// Profile Routes
userRouter.get("/profile", isAuthenticated, getUserProfile);
userRouter.put("/profile", isAuthenticated, upload.single("profilePhoto"), updateUserProfile);

// Logout User
userRouter.post("/logout", logout);

export default userRouter;