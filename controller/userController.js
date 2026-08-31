import pool from "../config/dbConfig.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import validator from "validator";
import sendEmail from "../utils/sendMail.js";

export const signup = async (req, res) => {
  try {

    const {
      full_name,
      email,
      password,
      phone
    } = req.body;

    // Check empty fields
    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields",
      });
    }

    // Validate email
    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email",
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Check existing user
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const newUser = await pool.query(
      `
      INSERT INTO users (
        full_name,
        email,
        password,
        phone
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, role
      `,
      [
        full_name,
        email,
        hashedPassword,
        phone || null
      ]
    );

    // Generate JWT token
    const token = jwt.sign(
      {
        id: newUser.rows[0].id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

      // Send Welcome Email
      await sendEmail(
          email,
          "Welcome to JoinTrip",
          `
        <h2>Welcome to JoinTrip ✈️</h2>

        <p>Hello ${full_name},</p>

        <p>Your account has been created successfully.</p>

        <p>Start planning your trips with JoinTrip.</p>

        <br/>

        <p>Thank You ❤️</p>
      `
      );


    // Send response

      res.cookie("token", token, {
          httpOnly: true,
          secure: false,
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: newUser.rows[0],
    });

  } catch (error) {
   

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

export const sendLoginOtp = async (req, res) => {
    try {

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required",
            });
        }

        // Find user
        const user = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found",
            });
        }

        // Generate OTP
        const otp = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        // OTP expiry (5 minutes)
        const expiry = new Date(
            Date.now() + 5 * 60 * 1000
        );

        // Save OTP
        await pool.query(
            `
      UPDATE users
      SET otp = $1,
          otp_expiry = $2
      WHERE email = $3
      `,
            [otp, expiry, email]
        );

        // Send Email
        await sendEmail(
            email,
            "JoinTrip Login OTP",
            `
        <h2>Your Login OTP: ${otp}</h2>

        <p>This OTP is valid for 5 minutes.</p>
      `
        );

        res.status(200).json({
            success: true,
            message: "OTP sent successfully",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const verifyLoginOtp = async (req, res) => {
    try {

        const { email, otp } = req.body;

        // Find user
        const user = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found",
            });
        }

        const existingUser = user.rows[0];

        // Check OTP
        if (existingUser.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        // Check expiry
        if (
            new Date(existingUser.otp_expiry) < new Date()
        ) {
            return res.status(400).json({
                success: false,
                message: "OTP expired",
            });
        }

        // Clear OTP
        await pool.query(
            `
      UPDATE users
      SET otp = NULL,
          otp_expiry = NULL
      WHERE email = $1
      `,
            [email]
        );

        // Generate JWT
        const token = jwt.sign(
            {
                id: existingUser.id,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d",
            }
        );
        res.cookie("token", token, {
            httpOnly: true,
            secure: false,
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.status(200).json({
            success: true,
            message: "Login successful",

            token,

            user: {
                id: existingUser.id,
                full_name: existingUser.full_name,
                email: existingUser.email,
                role: existingUser.role,
            },
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const signin = async (req, res) => {
    try {

        const { email, password } = req.body;

        // Check required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        // Find user by email
        const user = await pool.query(
            `
      SELECT * FROM users
      WHERE email = $1
      `,
            [email]
        );

        // User not found
        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        const existingUser = user.rows[0];

        // Compare password
        const isPasswordMatch = await bcrypt.compare(
            password,
            existingUser.password
        );

        // Wrong password
        if (!isPasswordMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: existingUser.id,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d",
            }
        );

        // Success response
        res.cookie("token", token, {
            httpOnly: true,
            secure: false,
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.status(200).json({
            success: true,
            message: "Login successful",

            token,

            user: {
                id: existingUser.id,
                full_name: existingUser.full_name,
                email: existingUser.email,
                role: existingUser.role,
            },
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const forgotPassword = async (req, res) => {
    try {

        const { email } = req.body;

        // Check email
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required",
            });
        }

        // Find user
        const user = await pool.query(
            `
      SELECT * FROM users
      WHERE email = $1
      `,
            [email]
        );

        // User not found
        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found",
            });
        }

        // Generate OTP
        const otp = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        // Expiry (5 minutes)
        const expiry = new Date(
            Date.now() + 5 * 60 * 1000
        );

        // Save OTP
        await pool.query(
            `
      UPDATE users
      SET
        reset_otp = $1,
        reset_otp_expiry = $2
      WHERE email = $3
      `,
            [otp, expiry, email]
        );

        // Send Email
        await sendEmail(
            email,
            "JoinTrip Password Reset OTP",
            `
        <h2>Your Password Reset OTP is:</h2>

        <h1>${otp}</h1>

        <p>This OTP is valid for 5 minutes.</p>
      `
        );

        res.status(200).json({
            success: true,
            message: "Reset OTP sent successfully",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const verifyResetOtp = async (req, res) => {
    try {

        const { email, otp } = req.body;

        // Find user
        const user = await pool.query(
            `
      SELECT * FROM users
      WHERE email = $1
      `,
            [email]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found",
            });
        }

        const existingUser = user.rows[0];

        // Check OTP
        if (existingUser.reset_otp !== otp) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        // Check expiry
        if (
            new Date(existingUser.reset_otp_expiry) < new Date()
        ) {
            return res.status(400).json({
                success: false,
                message: "OTP expired",
            });
        }

        res.status(200).json({
            success: true,
            message: "OTP verified successfully",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const googleLogin = async (req, res) => {
    try {
       

        const {
            firebase_uid,
            full_name,
            email,
            profile_photo,
        } = req.body;

        const existingUser = await pool.query(
            `
      SELECT *
      FROM users
      WHERE email = $1
      `,
            [email]
        );

        let user;

        if (existingUser.rows.length > 0) {
            user = existingUser.rows[0];
        } else {
            const newUser = await pool.query(
                `
        INSERT INTO users
        (
          firebase_uid,
          full_name,
          email,
          profile_photo
        )
        VALUES
        (
          $1,$2,$3,$4
        )
        RETURNING *
        `,
                [
                    firebase_uid,
                    full_name,
                    email,
                    profile_photo,
                ]
            );

            user = newUser.rows[0];
        }

        const token = jwt.sign(
            {
                id: user.id, // change to user.user_id if needed
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d",
            }
        );

        res
            .cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            })
            .status(200)
            .json({
                success: true,
                user,
            });

    } catch (error) {
        console.log(error);

        return res.status(500).json({
            success: false,
            message: "Google Login Failed",
        });
    }
};

export const resetPassword = async (req, res) => {
    try {

        const {
            email,
            otp,
            newPassword
        } = req.body;

        // Find user
        const user = await pool.query(
            `
      SELECT * FROM users
      WHERE email = $1
      `,
            [email]
        );

        // User not found
        if (user.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "User not found",
            });
        }

        const existingUser = user.rows[0];

        // Verify OTP
        if (existingUser.reset_otp !== otp) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        // Check expiry
        if (
            new Date(existingUser.reset_otp_expiry) < new Date()
        ) {
            return res.status(400).json({
                success: false,
                message: "OTP expired",
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(
            newPassword,
            10
        );

        // Update password
        await pool.query(
            `
      UPDATE users
      SET
        password = $1,
        reset_otp = NULL,
        reset_otp_expiry = NULL
      WHERE email = $2
      `,
            [hashedPassword, email]
        );

        res.status(200).json({
            success: true,
            message: "Password reset successful",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

export const logout = async (req, res) => {
    try {

        res.clearCookie("token");

        res.status(200).json({
            success: true,
            message: "Logout successful",
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: "Server Error",
        });
    }
};

/* ----------------------------------
    Ensure Profile Columns Exist
----------------------------------- */
const ensureProfileColumns = async () => {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone VARCHAR(255),
      ADD COLUMN IF NOT EXISTS city VARCHAR(255),
      ADD COLUMN IF NOT EXISTS country VARCHAR(255),
      ADD COLUMN IF NOT EXISTS bio TEXT,
      ADD COLUMN IF NOT EXISTS travel_style VARCHAR(255),
      ADD COLUMN IF NOT EXISTS favorite_destination VARCHAR(255),
      ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500),
      ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(500);
    `);
  } catch (e) {
    console.warn("Ensure profile columns warning:", e.message);
  }
};

/* ----------------------------------
    Get User Profile
----------------------------------- */
export const getUserProfile = async (req, res) => {
  try {
    await ensureProfileColumns();
    const userId = req.userId;

    const userResult = await pool.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const user = userResult.rows[0];

    let stats = { total_trips: 0, confirmed_trips: 0, countries_visited: 0 };
    try {
      const statsResult = await pool.query(
        `
        SELECT
          (SELECT COUNT(*)::int FROM bookings WHERE traveler_id = $1) AS total_trips,
          (SELECT COUNT(*)::int FROM bookings WHERE traveler_id = $1 AND booking_status IN ('confirmed', 'approved')) AS confirmed_trips,
          (SELECT COUNT(DISTINCT t.destination->>'country')::int FROM bookings b JOIN trips t ON b.trip_id = t.id WHERE b.traveler_id = $1) AS countries_visited
        `,
        [userId]
      );
      if (statsResult.rows.length > 0) {
        stats = statsResult.rows[0];
      }
    } catch (err) {
      console.warn("Stats query warning:", err.message);
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone || "",
        city: user.city || "",
        country: user.country || "",
        bio: user.bio || "",
        travelStyle: user.travel_style || user.travelStyle || "",
        favoriteDestination: user.favorite_destination || user.favoriteDestination || "",
        profilePhoto: user.profile_image || user.profile_photo || null,
        role: user.role || "traveler",
        createdAt: user.created_at
      },
      stats: {
        trips: Number(stats.total_trips || 0),
        confirmedTrips: Number(stats.confirmed_trips || 0),
        countries: Number(stats.countries_visited || 0)
      }
    });
  } catch (error) {
    console.error("Get User Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user profile",
      error: error.message
    });
  }
};

/* ----------------------------------
    Update User Profile
----------------------------------- */
export const updateUserProfile = async (req, res) => {
  try {
    await ensureProfileColumns();
    const userId = req.userId;

    const {
      full_name,
      phone,
      city,
      country,
      bio,
      travelStyle,
      favoriteDestination,
    } = req.body || {};

    let profilePhotoUrl = null;

    if (req.file) {
      const uploadedImage = await uploadImage(req.file.buffer);
      profilePhotoUrl = uploadedImage.secure_url;
    }

    const updateFields = [];
    const values = [];

    if (full_name !== undefined) {
      values.push(full_name.trim());
      updateFields.push(`full_name = $${values.length}`);
    }

    if (phone !== undefined) {
      values.push(phone.trim());
      updateFields.push(`phone = $${values.length}`);
    }

    if (city !== undefined) {
      values.push(city.trim());
      updateFields.push(`city = $${values.length}`);
    }

    if (country !== undefined) {
      values.push(country.trim());
      updateFields.push(`country = $${values.length}`);
    }

    if (bio !== undefined) {
      values.push(bio.trim());
      updateFields.push(`bio = $${values.length}`);
    }

    if (travelStyle !== undefined) {
      values.push(travelStyle.trim());
      updateFields.push(`travel_style = $${values.length}`);
    }

    if (favoriteDestination !== undefined) {
      values.push(favoriteDestination.trim());
      updateFields.push(`favorite_destination = $${values.length}`);
    }

    if (profilePhotoUrl) {
      values.push(profilePhotoUrl);
      updateFields.push(`profile_image = $${values.length}`);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update",
      });
    }

    values.push(userId);
    const query = `
      UPDATE users
      SET ${updateFields.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *;
    `;

    const { rows } = await pool.query(query, values);
    const updatedUser = rows[0];

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully!",
      user: {
        id: updatedUser.id,
        full_name: updatedUser.full_name,
        email: updatedUser.email,
        phone: updatedUser.phone || "",
        city: updatedUser.city || "",
        country: updatedUser.country || "",
        bio: updatedUser.bio || "",
        travelStyle: updatedUser.travel_style || updatedUser.travelStyle || "",
        favoriteDestination: updatedUser.favorite_destination || updatedUser.favoriteDestination || "",
        profilePhoto: updatedUser.profile_image || updatedUser.profile_photo || null,
        role: updatedUser.role || "traveler"
      }
    });
  } catch (error) {
    console.error("Update User Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message
    });
  }
};
