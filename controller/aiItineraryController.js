import pool from "../config/dbConfig.js";

/* ====================================================
   Ensure Trip Itineraries Table Exists
==================================================== */
const ensureItinerariesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trip_itineraries (
        id SERIAL PRIMARY KEY,
        trip_id VARCHAR(255) NOT NULL,
        day_number INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        activities TEXT[],
        accommodation_note VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_trip_day UNIQUE (trip_id, day_number)
      );
    `);
  } catch (error) {
    console.warn("Itineraries table initialization warning:", error.message);
  }
};

/* ====================================================
   Google Gemini AI Integration (Personalized Traveler Vibe)
==================================================== */
const callGeminiAPI = async (destName, durationDays, vibe) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in server/.env");
  }

  const travelerStyle = vibe ? String(vibe).trim() : "Adventure & Exploration";

  const prompt = `You are an expert personal travel guide.
Create a highly personalized ${durationDays}-day travel itinerary for a traveler visiting "${destName}".
The traveler describes their unique travel style and vibe as: "${travelerStyle}".

Tailor every single day, activity, description, packing item, and food tip specifically to their requested travel vibe ("${travelerStyle}").

Return ONLY raw JSON in this exact structure with no markdown codeblock delimiters (\`\`\`json) or extra conversational text:
{
  "destination": "${destName}",
  "durationDays": ${durationDays},
  "vibe": "${travelerStyle}",
  "itineraryDays": [
    {
      "dayNumber": 1,
      "title": "Day 1: Catchy Title tailored to ${travelerStyle}",
      "description": "Detailed immersive day description matching the traveler's style",
      "activities": ["Personalized Activity 1", "Personalized Activity 2", "Personalized Activity 3"],
      "accommodationNote": "Stay type matching their requested vibe"
    }
  ],
  "packingChecklist": ["Tailored Item 1", "Tailored Item 2", "Tailored Item 3"],
  "foodRecommendations": ["Local Specialty 1", "Recommended Spot 2"]
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Gemini API Error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  } else {
    throw new Error("Gemini AI did not return a valid JSON structure.");
  }
};

/* ====================================================
   Generate AI Itinerary API & Search Matching Real Trips
==================================================== */
export const generateAIItinerary = async (req, res) => {
  try {
    const { destination, duration, vibe } = req.body || {};

    const destName = destination ? (typeof destination === "object" ? destination.name || destination.city || "Expedition" : destination) : "Expedition";
    const durationDays = Number(duration) || 3;

    // Call Google Gemini AI strictly with custom traveler vibe
    const aiPlan = await callGeminiAPI(destName, durationDays, vibe || "Adventure & Exploration");

    // Query matching published real trips from PostgreSQL
    let matchingTrips = [];
    try {
      const searchPattern = `%${destName}%`;
      const vibePattern = `%${vibe}%`;

      const { rows } = await pool.query(
        `
        SELECT 
          t.id,
          t.trip_name,
          t.destination,
          t.category,
          t.price_per_person,
          t.start_date,
          t.end_date,
          t.travelers_limit,
          t.current_bookings,
          u.full_name AS host_name,
          u.profile_image AS host_photo,
          (
            SELECT image_url
            FROM trip_images ti
            WHERE ti.trip_id::text = t.id::text
            ORDER BY ti.is_cover DESC NULLS LAST, ti.id ASC
            LIMIT 1
          ) AS cover_image
        FROM trips t
        JOIN users u ON t.host_id = u.id
        WHERE t.status = 'published'
          AND (
            t.destination::text ILIKE $1 
            OR t.trip_name ILIKE $1 
            OR t.category ILIKE $2
          )
        ORDER BY t.start_date ASC
        LIMIT 6;
        `,
        [searchPattern, vibePattern]
      );

      matchingTrips = rows.map((r) => {
        let parsedDest = r.destination;
        if (typeof r.destination === "string") {
          try {
            parsedDest = JSON.parse(r.destination);
          } catch (e) {}
        }
        return {
          id: r.id,
          trip_name: r.trip_name,
          destination: parsedDest,
          category: r.category,
          price_per_person: r.price_per_person,
          start_date: r.start_date,
          end_date: r.end_date,
          travelers_limit: r.travelers_limit,
          current_bookings: r.current_bookings,
          full_name: r.host_name,
          profile_image: r.host_photo,
          cover_image: r.cover_image,
        };
      });
    } catch (e) {
      console.warn("Matching trips query warning:", e.message);
    }

    return res.status(200).json({
      success: true,
      message: "AI Itinerary generated successfully via Google Gemini AI!",
      plan: aiPlan,
      matchingTrips,
    });
  } catch (error) {
    console.error("Generate AI Itinerary Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate AI itinerary via Gemini AI.",
    });
  }
};

/* ====================================================
   Save Trip Itinerary (Host / Admin)
==================================================== */
export const saveTripItinerary = async (req, res) => {
  try {
    await ensureItinerariesTable();
    const { tripId, itineraryDays } = req.body || {};

    const formattedTripId = tripId ? String(tripId).trim() : "";
    if (!formattedTripId) {
      return res.status(400).json({
        success: false,
        message: "Trip ID is required.",
      });
    }

    if (!Array.isArray(itineraryDays) || itineraryDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one itinerary day step is required.",
      });
    }

    // Clear existing itinerary for trip
    await pool.query(`DELETE FROM trip_itineraries WHERE trip_id::text = $1`, [formattedTripId]);

    // Insert new itinerary steps
    for (const step of itineraryDays) {
      const dayNum = Number(step.dayNumber) || 1;
      const title = step.title || `Day ${dayNum}`;
      const desc = step.description || "";
      const acts = Array.isArray(step.activities) ? step.activities : (step.activities ? [step.activities] : []);
      const accom = step.accommodationNote || step.accommodation_note || "";

      await pool.query(
        `
        INSERT INTO trip_itineraries (trip_id, day_number, title, description, activities, accommodation_note, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [formattedTripId, dayNum, title, desc, acts, accom]
      );
    }

    return res.status(201).json({
      success: true,
      message: "Trip itinerary saved successfully!",
    });
  } catch (error) {
    console.error("Save Trip Itinerary Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save trip itinerary.",
      error: error.message,
    });
  }
};

/* ====================================================
   Get Stored Trip Itinerary
==================================================== */
export const getTripItinerary = async (req, res) => {
  try {
    await ensureItinerariesTable();
    const { tripId } = req.params;

    const query = `
      SELECT 
        id,
        trip_id,
        day_number AS "dayNumber",
        title,
        description,
        activities,
        accommodation_note AS "accommodationNote",
        created_at AS "createdAt"
      FROM trip_itineraries
      WHERE trip_id::text = $1
      ORDER BY day_number ASC;
    `;

    const { rows } = await pool.query(query, [String(tripId)]);

    return res.status(200).json({
      success: true,
      count: rows.length,
      itinerary: rows,
    });
  } catch (error) {
    console.error("Get Trip Itinerary Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch trip itinerary.",
      error: error.message,
    });
  }
};
