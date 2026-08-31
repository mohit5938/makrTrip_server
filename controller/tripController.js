
import pool from "../config/dbConfig.js";
import cloudinary from "../config/cloudinary.js";
import { uploadImage }
  from "../utils/uploadImage.js";
import axios from "axios";
export const searchDestination = async (
    req,
    res
) => {
    try {
        const { query } = req.query;

if (!query) {
  return res.status(400).json({
    success: false,
    message: "Search query required",
  });
}

const response = await axios.get(
  "https://api.geoapify.com/v1/geocode/autocomplete",
  {
    params: {
      text: query,
      limit: 5,
      apiKey: process.env.GEOAPIFY_API_KEY,
    },
  }
);

const places =
  response.data.features.map(
    (place) => ({
      place_id:
        place.properties.place_id,
      name:
        place.properties.formatted,
      city:
        place.properties.city,
      country:
        place.properties.country,
      lat:
        place.properties.lat,
      lng:
        place.properties.lon,
    })
  );

res.status(200).json({
  success: true,
  places,
});

    } catch (error) {
   console.log(error);

        
res.status(500).json({
  success: false,
  message:
    "Failed to fetch destinations",
});


    }
};


export const createTrip = async (req, res) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const hostId = req.userId;

    const {

      tripName,
      tripDescription,
      category,

      startLocation,
      destination,
      stops,

      accommodation,
      accommodationDescription,

      inclusions,
      exclusions,
      specialFeatures,

      accommodationCost,
      transportationCost,
      foodCost,
      otherExpenses,
      hostFee,

      travelersLimit,

      startDate,
      endDate

    } = req.body;


    if (!tripName?.trim()) {

      return res.status(400).json({
        success: false,
        message: "Trip name is required."
      });

    }

    if (!tripDescription?.trim()) {

      return res.status(400).json({
        success: false,
        message: "Trip description is required."
      });

    }

    if (!category) {

      return res.status(400).json({
        success: false,
        message: "Category is required."
      });

    }

    if (!startLocation) {

      return res.status(400).json({
        success: false,
        message: "Start location is required."
      });

    }

    if (!destination) {

      return res.status(400).json({
        success: false,
        message: "Destination is required."
      });

    }

    if (!travelersLimit || Number(travelersLimit) <= 0) {

      return res.status(400).json({
        success: false,
        message: "Traveler limit must be greater than 0."
      });

    }

    if (!startDate || !endDate) {

      return res.status(400).json({
        success: false,
        message: "Trip dates are required."
      });

    }

    if (new Date(endDate) < new Date(startDate)) {

      return res.status(400).json({
        success: false,
        message: "End date cannot be before start date."
      });

    }


    /* ----------------------------------
        Parse JSON Fields
    ----------------------------------- */

    const parsedStartLocation =
      startLocation
        ? JSON.parse(startLocation)
        : null;

    const parsedDestination =
      destination
        ? JSON.parse(destination)
        : null;

    const parsedInclusions =
      inclusions
        ? JSON.parse(inclusions)
        : [];

    const parsedExclusions =
      exclusions
        ? JSON.parse(exclusions)
        : [];

    const parsedSpecialFeatures =
      specialFeatures
        ? JSON.parse(specialFeatures)
        : [];

    const parsedOtherExpenses =
      otherExpenses
        ? JSON.parse(otherExpenses)
        : [];

    const parsedStops =
      stops
        ? JSON.parse(stops)
        : [];

    /* ----------------------------------
        Calculate Trip Pricing
    ----------------------------------- */

    const otherExpensesTotal =
      parsedOtherExpenses.reduce(

        (sum, expense) =>
          sum + (Number(expense.cost) || 0),0
      );

    const totalTripCost =

      Number(accommodationCost || 0) +

      Number(transportationCost || 0) +

      Number(foodCost || 0) +

      otherExpensesTotal;

   

      const guideFee = Number(hostFee || 0);

    const totalCollection =

      totalTripCost +

      guideFee;

    const pricePerPerson =

      Number(

        (

          totalCollection /

          Math.max(
            Number(travelersLimit || 1),
            1
          )

        ).toFixed(2)

      );

    /* ----------------------------------
        Create Trip
    ----------------------------------- */

    const tripResult = await client.query(

      `
            INSERT INTO trips (

                host_id,

                trip_name,
                trip_description,

                category,

                start_location,
                destination,

                accommodation,
                accommodation_description,

                inclusions,
                exclusions,
                special_features,

                accommodation_cost,
                transportation_cost,
                food_cost,
                other_expenses,

                host_fee,

                total_trip_cost,
                total_collection,
                price_per_person,

                travelers_limit,

                start_date,
                end_date,

                status

            )

            VALUES (

                $1,$2,$3,
                $4,
                $5,$6,
                $7,$8,
                $9,$10,$11,
                $12,$13,$14,$15,
                $16,
                $17,$18,$19,
                $20,
                $21,$22,
                'pending'

            )

            RETURNING id
            `,

      [

        hostId,

        tripName,
        tripDescription,

        category,

        JSON.stringify(parsedStartLocation),

        JSON.stringify(parsedDestination),

        accommodation,

        accommodationDescription,

        JSON.stringify(parsedInclusions),

        JSON.stringify(parsedExclusions),

        JSON.stringify(parsedSpecialFeatures),

        Number(accommodationCost || 0),

        Number(transportationCost || 0),

        Number(foodCost || 0),

        JSON.stringify(parsedOtherExpenses),

        guideFee,

        totalTripCost,

        totalCollection,

        pricePerPerson,

        Number(travelersLimit),

        startDate,

        endDate

      ]

    );

    const tripId =
      tripResult.rows[0].id;

  /* ---------- Continue with Stops & Images in Part 2 ---------- */
    /* ----------------------------------
        Save Trip Stops
    ----------------------------------- */

    if (
      parsedStops &&
      parsedStops.length > 0
    ) {

      for ( let i = 0; i < parsedStops.length; i++ ) {

        await client.query(

          `
            INSERT INTO trip_stops (

                trip_id,

                location,

                transport_mode,

                stop_order

            )

            VALUES (

                $1,

                $2,

                $3,

                $4

            )
            `,

          [

            tripId,

            JSON.stringify(

              parsedStops[i]
                .location

            ),

            parsedStops[i]
              .transportMode,

            i + 1,

          ]

        );

      }

    }

    /* ----------------------------------
        Upload Trip Images
    ----------------------------------- */

    if (

      req.files &&

      req.files.length > 0

    ) {

      for (

        let i = 0;

        i < req.files.length;

        i++

      ) {

        const uploadedImage =

          await uploadImage(

            req.files[i].buffer

          );

        await client.query(

          `
            INSERT INTO trip_images (

                trip_id,

                image_url,

                is_cover

            )

            VALUES (

                $1,

                $2,

                $3

            )
            `,

          [

            tripId,

            uploadedImage.secure_url,

            i === 0

          ]

        );

      }

    }

    /* ----------------------------------
        Commit Transaction
    ----------------------------------- */

    await client.query("COMMIT");

    return res.status(201).json({

      success: true,

      message:"Trip created successfully.",

      trip: {

        id: tripId,

        tripName,

        totalTripCost,

        totalCollection,

        pricePerPerson,

        status: "pending"

      }

    });
  }
    catch (error) {

      await client.query(
        "ROLLBACK"
      );

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Failed to create trip.",

        error:
          error.message,

      });

    }

    finally {

      client.release();

    }

  }


export const getPendingTrips = async (req, res) => 
  {

    try {

      const page =
        Number(req.query.page) || 1;

      const limit =
        Number(req.query.limit) || 10;

      const offset =
        (page - 1) * limit;

      const countResult =
        await pool.query(

          `
        SELECT COUNT(*)
        FROM trips
        WHERE status = 'pending'
        `
        );

      const totalTrips =
        Number(
          countResult.rows[0].count
        );

      const result =
        await pool.query(

          `
        SELECT
          t.*,
          u.full_name,
          u.email,
          u.profile_image

        FROM trips t

        JOIN users u
        ON t.host_id = u.id

        WHERE
        t.status = 'pending'

        ORDER BY
        t.created_at DESC

        LIMIT $1
        OFFSET $2
        `,

          [limit, offset]
        );

      return res.json({

        success: true,

        page,

        totalPages:
          Math.ceil(
            totalTrips / limit
          ),

        totalTrips,

        trips:
          result.rows,

      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch trips",

      });

    }

  };

export const approveTrip =
  async (req, res) => {

    try {

      const { id } =
        req.params;

      const result =
        await pool.query(

          `
          UPDATE trips

          SET
            status = 'published',

            updated_at = NOW()

          WHERE id = $1

          RETURNING *
          `,

          [id]

        );

      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            "Trip not found",

        });

      }

      return res.status(200).json({

        success: true,

        message:
          "Trip approved successfully",

        trip:
          result.rows[0],

      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Failed to approve trip",

      });

    }

  };

export const rejectTrip =
  async (req, res) => {

    try {

      const { id } =  req.params;

      const result =  await pool.query(

          `
          UPDATE trips
          SET
            status = 'rejected',

            updated_at = NOW()

          WHERE id = $1

          RETURNING *
          `,

          [id]

        );

      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          message:
            "Trip not found",

        });

      }

      return res.status(200).json({

        success: true,

        message:
          "Trip rejected successfully",

        trip:
          result.rows[0],

      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Failed to reject trip",

      });

    }

  };

export const getTopDestinations =
  async (req, res) => {

    try {

      const result =
        await pool.query(

          `
          SELECT

            t.destination->>'name'
            AS destination_name,

            COUNT(DISTINCT t.id)
            AS total_trips,

            MIN(ti.image_url)
            AS cover_image

          FROM trips t

          LEFT JOIN trip_images ti

          ON ti.trip_id = t.id
          WHERE
          t.status = 'published'
          AND t.end_date >= CURRENT_DATE

          GROUP BY
            destination_name

          ORDER BY
            total_trips DESC

          LIMIT 8
          `
        );

      return res.status(200).json({

        success: true,

        destinations:
          result.rows,

      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch top destinations",

      });

    }

  };

export const getAllTrips = async (req, res) => {

  try {

    /* ----------------------------------
        Query Parameters
    ----------------------------------- */

    const {

      destination,

      category,

      fromDate,

      toDate,

      travelers,

      budget,

      accommodation,

      sortBy = "Recommended",

      page = 1,

      limit = 12,

    } = req.query;

  

    /* ----------------------------------
        Pagination
    ----------------------------------- */

    const currentPage =

      Math.max(
        Number(page) || 1,
        1
      );

    const pageLimit =

      Math.max(
        Number(limit) || 12,
        1
      );

    const offset =

      (currentPage - 1) *
      pageLimit;

    /* ----------------------------------
        Dynamic WHERE Clause
    ----------------------------------- */

    const where = [];

    const values = [];

    // Only show published trips
    where.push(`
    t.status = 'published'
    AND
    t.end_date >= CURRENT_DATE
`);
   

    /* ----------------------------------
        Destination Search
    ----------------------------------- */

    if (destination?.trim()) {

      values.push(
        `%${destination.trim()}%`
      );

      where.push(`

              (
    LOWER(t.destination->>'name')
    LIKE LOWER($${values.length})

    OR

    LOWER(t.trip_name)
    LIKE LOWER($${values.length})
)

            `);

    }

    /* ----------------------------------
        Category
    ----------------------------------- */

    if (category?.trim()) {

      values.push(category);

      where.push(

        `t.category = $${values.length}`

      );

    }

    /* ----------------------------------
        Date Filters
    ----------------------------------- */

    if (fromDate) {

      values.push(fromDate);

      where.push(

        `t.start_date >= $${values.length}`

      );

    }

    if (toDate) {

      values.push(toDate);

      where.push(

        `t.end_date <= $${values.length}`

      );

    }

    /* ----------------------------------
        Travelers
    ----------------------------------- */

    if (travelers) {

      values.push(

        Number(travelers)

      );

      where.push(

        `t.travelers_limit >= $${values.length}`

      );

    }

    /* ----------------------------------
        Budget
    ----------------------------------- */

    if (budget) {

      values.push(

        Number(budget)

      );

      where.push(

        `t.price_per_person <= $${values.length}`

      );

    }

    /* ----------------------------------
        Accommodation
    ----------------------------------- */

    if (accommodation?.trim()) {

      values.push(accommodation);

      where.push(`

                LOWER(

                    t.accommodation

                )

                = LOWER(

                    $${values.length}

                )

            `);

    }

    /* ----------------------------------
        Sorting
    ----------------------------------- */

    const sortMap = {

      "Recommended":

        "t.created_at DESC",

      "Newest":

        "t.created_at DESC",

      "Oldest":

        "t.created_at ASC",

      "Price: Low to High":

        "t.price_per_person ASC",

      "Price: High to Low":

        "t.price_per_person DESC",

      "Departure Date":

        "t.start_date ASC",

    };

    const orderBy =

      sortMap[sortBy] ||

      "t.created_at DESC";

/* ----------------------------------
    Ready for SQL Query
    (Continue in Part 2)
----------------------------------- */
    /* ----------------------------------
        Main Query
    ----------------------------------- */

    values.push(pageLimit);
    values.push(offset);
    // console.log(where);
    // console.log(values);
    const tripsResult = await pool.query(

      `
    SELECT
         t.id,
    t.trip_name,
    t.category,
    t.destination,
    t.start_date,
    t.end_date,
    t.travelers_limit,
    t.price_per_person,
    t.total_collection,
    u.full_name,
    u.profile_image,
    cover.image_url AS cover_image

    FROM trips t

    INNER JOIN users u

        ON u.id = t.host_id

    LEFT JOIN LATERAL (

        SELECT

            image_url

        FROM trip_images

        WHERE trip_id = t.id

        ORDER BY

            is_cover DESC,

            id ASC

        LIMIT 1

    ) cover

    ON TRUE

    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}

    ORDER BY ${orderBy}

    LIMIT $${values.length - 1}

    OFFSET $${values.length}
    `,

      values

    );

    /* ----------------------------------
        Count Query
    ----------------------------------- */

    const countValues = values.slice(
      0,
      values.length - 2
    );

    const countResult = await pool.query(

      `
    SELECT

        COUNT(*) AS total

    FROM trips t

    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,

      countValues

    );

    const totalTrips = Number(
      countResult.rows[0].total
    );

    const totalPages = Math.ceil(

      totalTrips /

      pageLimit

    );

/* ----------------------------------
    Ready for Response
    (Continue in Part 3)
----------------------------------- */
    /* ----------------------------------
        Success Response
    ----------------------------------- */

    return res.status(200).json({

      success: true,

      message: "Trips fetched successfully.",

      trips: tripsResult.rows,

      pagination: {

        currentPage,

        pageLimit,

        totalTrips,

        totalPages,

        hasPreviousPage:
          currentPage > 1,

        hasNextPage:
          currentPage < totalPages,

      },

    });

    /* ----------------------------------
        Error Handling
    ----------------------------------- */

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,

      message:
        "Failed to fetch trips.",

    });

  }
};

export const getTripById = async (req, res) => {

  try {

    const { tripId } = req.params;

    if (!tripId) {
      return res.status(400).json({
        success: false,
        message: "Trip id is required."
      });

    }
    const tripResult = await pool.query(
      `
            SELECT
                t.*,
                u.id AS host_id,
                u.full_name,
                u.profile_image
                

                 FROM trips t
                  INNER JOIN users u
                  ON u.id = t.host_id

            WHERE

                t.id = $1
                AND t.status = 'published'
                AND t.end_date >= CURRENT_DATE
            `,

      [tripId]

    );

    if (tripResult.rows.length === 0) {

      return res.status(404).json({

        success: false,

        message: "Trip not found."

      });

    }

    const trip = tripResult.rows[0];

    const [

      coverImage,
      stopsResult,

    ] = await Promise.all([

      pool.query(

        `
       SELECT

    image_url

FROM trip_images

WHERE

    trip_id = $1

    AND is_cover = TRUE

LIMIT 1
        `,

        [tripId]

      ),

      pool.query(

        `
        SELECT

            id,
            location,
            transport_mode,
            stop_order

        FROM trip_stops

        WHERE trip_id = $1

        ORDER BY stop_order ASC
        `,

        [tripId]

      )

    ]);

    /* ----------------------------------
        Temporary
    ----------------------------------- */

    const currentBookings = 0;


    const tripData = {

      ...trip,

      current_bookings: currentBookings,

      cover_image: coverImage.rows[0]?.image_url || null ,

      stops: stopsResult.rows,

    };
   
    return res.status(200).json({

      success: true,

      message: "Trip fetched successfully.",

      trip: tripData,

    });

  }

  catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,

      message: "Failed to fetch trip details.",

      error: error.message,

    });

  }

};