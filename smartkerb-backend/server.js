import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./config/db.js";

dotenv.config();

const app = express();

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(cors());
app.use(express.json());

// =========================================================
// 30-MINUTE TIME SLOT HELPERS
// =========================================================

  const isValid30MinuteTime = (time) => {
    if (!time) return false;

    const parts = time.split(":").map(Number);

    if (parts.length < 2) return false;

    const hours = parts[0];
    const minutes = parts[1];

    return (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      hours >= 0 &&
      hours <= 23 &&
      (minutes === 0 || minutes === 30)
    );
  };

  const getNext30MinuteSlot = () => {
    const now = new Date();

    // Convert current time to IST
    const istString = now.toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    });

    const istNow = new Date(istString);

    let hours = istNow.getHours();
    let minutes = istNow.getMinutes();

    // Round UP to the next 30-minute slot
    if (minutes === 0) {
      minutes = 0;
    } else if (minutes <= 30) {
      minutes = 30;
    } else {
      minutes = 0;
      hours += 1;
    }

    // If rounding pushes us past midnight
    if (hours >= 24) {
      hours = 23;
      minutes = 30;
    }

    return {
      hours,
      minutes,
    };
  };

  const formatTime = (hours, minutes) => {
    return `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:00`;
  };

// =========================================================
// JWT AUTHENTICATION MIDDLEWARE
// =========================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  const token =
    authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Authentication token required",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET,
    (error, user) => {
      if (error) {
        return res.status(403).json({
          message: "Invalid or expired token",
        });
      }

      req.user = user;
      next();
    }
  );
};

// =========================================================
// HOME ROUTE
// =========================================================

app.get("/", (req, res) => {
  res.json({
    message: "SmartKerb backend is running 🚗",
  });
});

// =========================================================
// TEST DATABASE
// =========================================================

app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT 1 AS result"
    );

    res.json({
      message: "MySQL connection successful",
      database: rows,
    });

  } catch (error) {

    console.error(
      "Database test error:",
      error
    );

    res.status(500).json({
      message: "MySQL connection failed",
      error: error.message,
    });
  }
});

// =========================================================
// GET ALL PARKING LOCATIONS
//
// Supports:
//
// /api/parking
//
// /api/parking?date=2026-08-20
//
// /api/parking?date=2026-08-20&arrivalTime=15:30&duration=2
//
// When date + time + duration are supplied,
// availability is calculated specifically for that slot.
// =========================================================

app.get("/api/parking", async (req, res) => {

  try {

    const {
      date,
      arrivalTime,
      duration,
    } = req.query;

    // =======================================================
    // DEFAULT DATE
    // =======================================================

    const selectedDate =
      date ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date());

    // =======================================================
    // GET PARKING LOCATIONS
    // =======================================================

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.address,
        p.total_spots,
        p.available_spots AS base_available_spots,
        p.price_per_hour,
        p.walking_time,
        p.rating,
        p.status AS parking_status,
        p.latitude,
        p.longitude

      FROM parking_locations p

      ORDER BY p.id
      `
    );

    // =======================================================
    // NO TIME SLOT SELECTED
    //
    // Return normal daily availability.
    // =======================================================

    if (!arrivalTime || !duration) {

      const result = await Promise.all(

        rows.map(async (parking) => {

          const totalSpots =
            Number(parking.total_spots);

          // Count currently active bookings
          // for this parking location today/selected date
          const [bookingRows] =
            await db.query(
              `
              SELECT COUNT(*) AS occupiedSpots

              FROM bookings

              WHERE parking_id = ?

              AND booking_date = ?

              AND status = 'Active'
              `,
              [
                parking.id,
                selectedDate,
              ]
            );

          const occupiedSpots =
            Number(
              bookingRows[0].occupiedSpots
            );

          const availableSpots =
            Math.max(
              0,
              totalSpots - occupiedSpots
            );

          let status = "Available";

          if (
            parking.parking_status &&
            parking.parking_status.toLowerCase() === "closed"
          ) {

            status = "Closed";

          } else if (availableSpots <= 0) {

            status = "Full";

          } else if (
            availableSpots <= totalSpots * 0.30
          ) {

            status = "Limited";
          }

          return {

            id:
              parking.id,

            name:
              parking.name,

            address:
              parking.address,

            total_spots:
              totalSpots,

            available_spots:
              availableSpots,

            occupied_spots:
              occupiedSpots,

            price_per_hour:
              Number(
                parking.price_per_hour
              ),

            walking_time:
              parking.walking_time,

            rating:
              Number(
                parking.rating
              ),

            status,

            latitude:
              parking.latitude,

            longitude:
              parking.longitude,

            selected_date:
              selectedDate,
          };
        })
      );

      return res.json(result);
    }

    // =======================================================
    // VALIDATE DURATION
    // =======================================================

    const numericDuration =
      Number(duration);

    if (
      !Number.isFinite(numericDuration) ||
      numericDuration <= 0
    ) {

      return res.status(400).json({
        message:
          "Invalid parking duration",
      });
    }

    // =======================================================
    // VALIDATE ARRIVAL TIME
    // =======================================================

    const timeParts =
      arrivalTime
        .split(":")
        .map(Number);

    if (timeParts.length < 2) {

      return res.status(400).json({
        message:
          "Invalid arrival time",
      });
    }

    const startHours =
      timeParts[0];

    const startMinutes =
      timeParts[1];

    if (
      !Number.isFinite(startHours) ||
      !Number.isFinite(startMinutes) ||
      startHours < 0 ||
      startHours > 23 ||
      startMinutes < 0 ||
      startMinutes > 59 ||
      !isValid30MinuteTime(arrivalTime)
    ) {
      return res.status(400).json({
        message:
          "Arrival time must be in 30-minute intervals",
      });
    }

    // =======================================================
    // CALCULATE START TIME
    // =======================================================

    const startTotalMinutes =
      startHours * 60 +
      startMinutes;

    // =======================================================
    // CALCULATE END TIME
    // =======================================================

    const endTotalMinutes =
      startTotalMinutes +
      numericDuration * 60;

    if (
      endTotalMinutes > 24 * 60
    ) {

      return res.status(400).json({
        message:
          "Parking duration cannot extend into the next day",
      });
    }

    const endHours =
      Math.floor(
        endTotalMinutes / 60
      );

    const endMinutes =
      endTotalMinutes % 60;

    const startTime =
      `${String(startHours).padStart(2, "0")}:${String(
        startMinutes
      ).padStart(2, "0")}:00`;

    const endTime =
      `${String(endHours).padStart(2, "0")}:${String(
        endMinutes
      ).padStart(2, "0")}:00`;

    // =======================================================
    // CALCULATE SLOT AVAILABILITY
    // FOR EVERY PARKING LOCATION
    // =======================================================

    const result = await Promise.all(

      rows.map(async (parking) => {

        // ---------------------------------------------------
        // TOTAL PARKING SPOTS
        // ---------------------------------------------------

        const totalSpots =
          Number(parking.total_spots);

        // ---------------------------------------------------
        // COUNT BOOKINGS THAT OVERLAP
        //
        // Existing booking:
        //      10:00 - 12:00
        //
        // Requested:
        //      11:00 - 13:00
        //
        // OVERLAP ✓
        //
        // Existing:
        //      10:00 - 12:00
        //
        // Requested:
        //      12:00 - 14:00
        //
        // NO OVERLAP ✓
        // ---------------------------------------------------

        const [bookingRows] =
          await db.query(
            `
            SELECT COUNT(*) AS occupiedSpots

            FROM bookings

            WHERE parking_id = ?

              AND booking_date = ?

              AND status = 'Active'

              AND arrival_time < ?

              AND end_time > ?
            `,
            [
              parking.id,
              selectedDate,
              endTime,
              startTime,
            ]
          );

        const occupiedSpots =
          Number(
            bookingRows[0]
              .occupiedSpots
          );

        // ---------------------------------------------------
        // SLOT AVAILABILITY
        // ---------------------------------------------------

        const availableSpots =
          Math.max(
            0,
            totalSpots -
              occupiedSpots
          );

        // ---------------------------------------------------
        // STATUS
        // ---------------------------------------------------

        let status = "Available";

        if (
          parking.parking_status &&
          parking.parking_status.toLowerCase() === "closed"
        ) {

          status = "Closed";

        } else if (
          availableSpots <= 0
        ) {

          status = "Full";

        } else if (
          availableSpots <=
          totalSpots * 0.30
        ) {

          status = "Limited";
        }

        // ---------------------------------------------------
        // RETURN PARKING
        // ---------------------------------------------------

        return {

          id:
            parking.id,

          name:
            parking.name,

          address:
            parking.address,

          total_spots:
            totalSpots,

          available_spots:
            availableSpots,

          occupied_spots:
            occupiedSpots,

          price_per_hour:
            Number(
              parking.price_per_hour
            ),

          walking_time:
            parking.walking_time,

          rating:
            Number(
              parking.rating
            ),

          status,

          latitude:
            parking.latitude,

          longitude:
            parking.longitude,

          selected_date:
            selectedDate,

          arrival_time:
            startTime,

          end_time:
            endTime,

          duration:
            numericDuration,
        };
      })
    );

    // =======================================================
    // RETURN SLOT-SPECIFIC AVAILABILITY
    // =======================================================

    return res.json(result);

  } catch (error) {

    console.error(
      "Parking fetch error:",
      error
    );

    return res.status(500).json({
      message:
        "Failed to fetch parking locations",

      error:
        error.message,
    });
  }
});

// =========================================================
// GET PARKING AVAILABILITY FOR SPECIFIC LOCATION
//
// Example:
//
// /api/parking/1/availability
//
// /api/parking/1/availability?date=2026-08-20
//
// /api/parking/1/availability?date=2026-08-20&arrivalTime=15:30&duration=2
// =========================================================

app.get(
  "/api/parking/:parkingId/availability",
  async (req, res) => {

    try {

      const {
        parkingId,
      } = req.params;

      const {
        date,
        arrivalTime,
        duration,
      } = req.query;

      // =====================================================
      // VALIDATE DATE
      // =====================================================

      if (!date) {

        return res.status(400).json({
          message:
            "Date is required",
        });
      }

      // =====================================================
      // GET PARKING
      // =====================================================

      const [parkingRows] =
        await db.query(
          `
          SELECT
            id,
            total_spots,
            available_spots,
            price_per_hour,
            status

          FROM parking_locations

          WHERE id = ?
          `,
          [parkingId]
        );

      if (
        parkingRows.length === 0
      ) {

        return res.status(404).json({
          message:
            "Parking location not found",
        });
      }

      const parking =
        parkingRows[0];

      // =====================================================
      // NO TIME SLOT
      // =====================================================

      if (
        !arrivalTime ||
        !duration
      ) {

        const [availabilityRows] =
          await db.query(
            `
            SELECT
              available_spots

            FROM parking_daily_availability

            WHERE parking_id = ?

            AND availability_date = ?
            `,
            [
              parkingId,
              date,
            ]
          );

        // ===================================================
        // CREATE DAILY AVAILABILITY IF MISSING
        // ===================================================

        if (
          availabilityRows.length === 0
        ) {

          await db.query(
            `
            INSERT INTO
            parking_daily_availability
            (
              parking_id,
              availability_date,
              available_spots
            )

            VALUES (?, ?, ?)
            `,
            [
              parkingId,
              date,
              parking.total_spots,
            ]
          );

          return res.json({

            parkingId:
              Number(parkingId),

            date,

            availableSpots:
              Number(
                parking.total_spots
              ),

            totalSpots:
              Number(
                parking.total_spots
              ),
          });
        }

        return res.json({

          parkingId:
            Number(parkingId),

          date,

          availableSpots:
            Number(
              availabilityRows[0]
                .available_spots
            ),

          totalSpots:
            Number(
              parking.total_spots
            ),
        });
      }

      // =====================================================
      // VALIDATE DURATION
      // =====================================================

      const numericDuration =
        Number(duration);

      if (
        !Number.isFinite(
          numericDuration
        ) ||
        numericDuration <= 0
      ) {

        return res.status(400).json({
          message:
            "Invalid parking duration",
        });
      }

      // =====================================================
      // VALIDATE ARRIVAL TIME
      // =====================================================

      const [
        startHours,
        startMinutes,
      ] =
        arrivalTime
          .split(":")
          .map(Number);

      if (
        !Number.isFinite(startHours) ||
        !Number.isFinite(startMinutes) ||
        startHours < 0 ||
        startHours > 23 ||
        startMinutes < 0 ||
        startMinutes > 59 ||
        !isValid30MinuteTime(arrivalTime)
      ) {
        return res.status(400).json({
          message:
            "Arrival time must be in 30-minute intervals",
        });
      }

      // =====================================================
      // CALCULATE TIMES
      // =====================================================

      const startTotalMinutes =
        startHours * 60 +
        startMinutes;

      const endTotalMinutes =
        startTotalMinutes +
        numericDuration * 60;

      if (
        endTotalMinutes >
        24 * 60
      ) {

        return res.status(400).json({
          message:
            "Parking duration cannot extend into the next day",
        });
      }

      const endHours =
        Math.floor(
          endTotalMinutes / 60
        );

      const endMinutes =
        endTotalMinutes % 60;

      const startTime =
        `${String(startHours).padStart(2, "0")}:${String(
          startMinutes
        ).padStart(2, "0")}:00`;

      const endTime =
        `${String(endHours).padStart(2, "0")}:${String(
          endMinutes
        ).padStart(2, "0")}:00`;

      // =====================================================
      // COUNT OVERLAPPING BOOKINGS
      // =====================================================

      const [bookingRows] =
        await db.query(
          `
          SELECT COUNT(*) AS overlappingBookings

          FROM bookings

          WHERE parking_id = ?

          AND booking_date = ?

          AND status = 'Active'

          AND arrival_time < ?

          AND end_time > ?
          `,
          [
            parkingId,
            date,
            endTime,
            startTime,
          ]
        );

      const occupiedSpots =
        Number(
          bookingRows[0]
            .overlappingBookings
        );

      // =====================================================
      // CALCULATE AVAILABILITY
      // =====================================================

      const totalSpots =
        Number(
          parking.total_spots
        );

      const availableSpots =
        Math.max(
          0,
          totalSpots -
            occupiedSpots
        );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.json({

        parkingId:
          Number(parkingId),

        date,

        arrivalTime:
          startTime,

        endTime,

        duration:
          numericDuration,

        totalSpots,

        occupiedSpots,

        availableSpots,
      });

    } catch (error) {

      console.error(
        "Availability fetch error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch parking availability",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// SIGN UP
// =========================================================

app.post(
  "/api/auth/signup",
  async (req, res) => {

    try {

      const {
        phone,
        password,
      } = req.body;

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !phone ||
        !password
      ) {

        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      if (
        password.length < 6
      ) {

        return res.status(400).json({
          message:
            "Password must contain at least 6 characters",
        });
      }

      // =====================================================
      // CHECK EXISTING USER
      // =====================================================

      const [existingUsers] =
        await db.query(
          `
          SELECT id

          FROM users

          WHERE phone = ?
          `,
          [phone]
        );

      if (
        existingUsers.length > 0
      ) {

        return res.status(409).json({
          message:
            "An account with this phone number already exists",
        });
      }

      // =====================================================
      // HASH PASSWORD
      // =====================================================

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      // =====================================================
      // CREATE USER
      // =====================================================

      await db.query(
        `
        INSERT INTO users
        (
          phone,
          password
        )

        VALUES (?, ?)
        `,
        [
          phone,
          hashedPassword,
        ]
      );

      return res.status(201).json({
        message:
          "Account created successfully",
      });

    } catch (error) {

      console.error(
        "Signup error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to create account",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// LOGIN
// =========================================================

app.post(
  "/api/auth/login",
  async (req, res) => {

    try {

      const {
        phone,
        password,
      } = req.body;

      console.log(
        "Login attempt:",
        phone
      );

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !phone ||
        !password
      ) {

        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      // =====================================================
      // FIND USER
      // =====================================================

      const [users] =
        await db.query(
          `
          SELECT
            id,
            phone,
            password

          FROM users

          WHERE phone = ?
          `,
          [phone]
        );

      if (
        users.length === 0
      ) {

        return res.status(401).json({
          message:
            "Invalid phone number or password",
        });
      }

      const user =
        users[0];

      // =====================================================
      // CHECK PASSWORD
      // =====================================================

      const passwordMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!passwordMatch) {

        return res.status(401).json({
          message:
            "Invalid phone number or password",
        });
      }

      // =====================================================
      // CHECK JWT SECRET
      // =====================================================

      if (
        !process.env.JWT_SECRET
      ) {

        return res.status(500).json({
          message:
            "JWT_SECRET is missing from .env",
        });
      }

      // =====================================================
      // CREATE TOKEN
      // =====================================================

      const token =
        jwt.sign(
          {
            userId:
              user.id,

            phone:
              user.phone,
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              "1d",
          }
        );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.json({

        message:
          "Login successful",

        token,

        user: {

          id:
            user.id,

          phone:
            user.phone,
        },
      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        message:
          "Login failed",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// GET MY ACTIVE BOOKINGS
// =========================================================

app.get(
  "/api/bookings",
  authenticateToken,
  async (req, res) => {

    try {

      console.log(
        "Fetching active bookings for user:",
        req.user.userId
      );

      const [rows] =
        await db.query(
          `
          SELECT

            b.id,

            b.booking_id,

            b.user_id,

            b.parking_id,

            b.booking_date,

            b.arrival_time,

            b.end_time,

            b.duration,

            b.total_price,

            b.status,

            p.name,

            p.address,

            p.available_spots,

            p.total_spots,

            p.price_per_hour,

            p.walking_time,

            p.rating

          FROM bookings b

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          WHERE b.user_id = ?

          AND b.status = 'Active'

          ORDER BY
            b.booking_date DESC,
            b.arrival_time DESC
          `,
          [
            req.user.userId,
          ]
        );

      return res.status(200).json(
        rows
      );

    } catch (error) {

      console.error(
        "Fetch bookings error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch bookings",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// GET PARKING HISTORY
// =========================================================

app.get(
  "/api/bookings/history",
  authenticateToken,
  async (req, res) => {

    try {

      console.log(
        "Fetching parking history for user:",
        req.user.userId
      );

      const [rows] =
        await db.query(
          `
          SELECT

            b.id,

            b.booking_id,

            b.user_id,

            b.parking_id,

            b.booking_date,

            b.arrival_time,

            b.end_time,

            b.duration,

            b.total_price,

            b.status,

            p.name,

            p.address,

            p.available_spots,

            p.total_spots,

            p.price_per_hour,

            p.walking_time,

            p.rating

          FROM bookings b

          INNER JOIN parking_locations p
            ON b.parking_id = p.id

          WHERE b.user_id = ?

          AND b.status IN (
            'Cancelled',
            'Completed'
          )

          ORDER BY
            b.booking_date DESC,
            b.arrival_time DESC
          `,
          [
            req.user.userId,
          ]
        );

      return res.status(200).json(
        rows
      );

    } catch (error) {

      console.error(
        "Fetch parking history error:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch parking history",

        error:
          error.message,
      });
    }
  }
);

// =========================================================
// CREATE PARKING BOOKING
// =========================================================

app.post(
  "/api/bookings",
  authenticateToken,
  async (req, res) => {

    let connection;

    try {

      console.log(
        "BOOKING REQUEST RECEIVED"
      );

      console.log(
        "User:",
        req.user
      );

      console.log(
        "Body:",
        req.body
      );

      const {
        parkingId,
        bookingDate,
        arrivalTime,
        duration,
      } = req.body;

      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !parkingId ||
        !bookingDate ||
        !arrivalTime ||
        !duration
      ) {

        return res.status(400).json({
          message:
            "All booking details are required",
        });
      }

      // =====================================================
      // VALIDATE DURATION
      // =====================================================

      const numericDuration =
        Number(duration);

      if (
        !Number.isFinite(
          numericDuration
        ) ||
        numericDuration <= 0
      ) {

        return res.status(400).json({
          message:
            "Invalid parking duration",
        });
      }

      // =====================================================
      // VALIDATE ARRIVAL TIME
      // =====================================================

      const [
        startHours,
        startMinutes,
      ] =
        arrivalTime
          .split(":")
          .map(Number);

      if (
        !Number.isFinite(startHours) ||
        !Number.isFinite(startMinutes) ||
        startHours < 0 ||
        startHours > 23 ||
        startMinutes < 0 ||
        startMinutes > 59 ||
        !isValid30MinuteTime(arrivalTime)
      ) {
        return res.status(400).json({
          message:
            "Arrival time must be in 30-minute intervals",
        });
      }

      // =====================================================
      // CALCULATE END TIME
      // =====================================================

      const startTotalMinutes =
        startHours * 60 +
        startMinutes;

      const endTotalMinutes =
        startTotalMinutes +
        numericDuration * 60;

      if (
        endTotalMinutes >
        24 * 60
      ) {

        return res.status(400).json({
          message:
            "Parking duration cannot extend into the next day",
        });
      }

      const endHours =
        Math.floor(
          endTotalMinutes / 60
        );

      const endMinutes =
        endTotalMinutes % 60;

      const normalizedArrivalTime =
        `${String(startHours).padStart(2, "0")}:${String(
          startMinutes
        ).padStart(2, "0")}:00`;

      const endTime =
        `${String(endHours).padStart(2, "0")}:${String(
          endMinutes
        ).padStart(2, "0")}:00`;

      // =====================================================
      // DATABASE CONNECTION
      // =====================================================

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      // =====================================================
      // CHECK PARKING LOCATION
      // =====================================================

      const [parkingRows] =
        await connection.query(
          `
          SELECT
            id,
            total_spots,
            price_per_hour,
            status

          FROM parking_locations

          WHERE id = ?

          FOR UPDATE
          `,
          [
            parkingId,
          ]
        );

      if (
        parkingRows.length === 0
      ) {

        await connection.rollback();

        return res.status(404).json({
          message:
            "Parking location not found",
        });
      }

      const parking =
        parkingRows[0];

      // =====================================================
      // CHECK PARKING STATUS
      // =====================================================

      if (
        parking.status &&
        parking.status.toLowerCase() ===
          "closed"
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "This parking location is currently unavailable",
        });
      }

      // =====================================================
      // CHECK OVERLAPPING BOOKINGS
      // =====================================================

      const [
        overlappingBookings,
      ] =
        await connection.query(
          `
          SELECT
            id,
            booking_id

          FROM bookings

          WHERE parking_id = ?

          AND booking_date = ?

          AND status = 'Active'

          AND arrival_time < ?

          AND end_time > ?

          FOR UPDATE
          `,
          [
            parkingId,
            bookingDate,
            endTime,
            normalizedArrivalTime,
          ]
        );

      // =====================================================
      // IMPORTANT:
      // Each booking consumes ONE parking spot.
      // =====================================================

      if (
        overlappingBookings.length >=
        Number(parking.total_spots)
      ) {

        await connection.rollback();

        return res.status(409).json({
          message:
            "No parking spots are available during the selected time slot.",
        });
      }

      // =====================================================
      // CALCULATE PRICE
      // =====================================================

      const pricePerHour =
        Number(
          parking.price_per_hour
        );

      if (
        !Number.isFinite(
          pricePerHour
        ) ||
        pricePerHour < 0
      ) {

        await connection.rollback();

        return res.status(500).json({
          message:
            "Invalid parking price configuration",
        });
      }

      const calculatedTotalPrice =
        Number(
          (
            pricePerHour *
            numericDuration
          ).toFixed(2)
        );

      // =====================================================
      // GENERATE BOOKING ID
      // =====================================================

      let bookingId;

      let bookingExists = true;

      while (
        bookingExists
      ) {

        bookingId =
          "SK" +
          Math.floor(
            100000 +
            Math.random() *
              900000
          );

        const [existing] =
          await connection.query(
            `
            SELECT id

            FROM bookings

            WHERE booking_id = ?
            `,
            [
              bookingId,
            ]
          );

        bookingExists =
          existing.length > 0;
      }

      // =====================================================
      // CREATE BOOKING
      // =====================================================

      await connection.query(
        `
        INSERT INTO bookings
        (
          booking_id,
          user_id,
          parking_id,
          booking_date,
          arrival_time,
          end_time,
          duration,
          total_price,
          status
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          bookingId,

          req.user.userId,

          parkingId,

          bookingDate,

          normalizedArrivalTime,

          endTime,

          numericDuration,

          calculatedTotalPrice,

          "Active",
        ]
      );

      // =====================================================
      // COMMIT
      // =====================================================

      await connection.commit();

      console.log(
        "Booking created successfully:",
        bookingId
      );

      // =====================================================
      // RESPONSE
      // =====================================================

      return res.status(201).json({

        message:
          "Booking created successfully",

        bookingId,

        booking: {

          bookingId,

          parkingId:
            Number(parkingId),

          bookingDate,

          arrivalTime:
            normalizedArrivalTime,

          endTime,

          duration:
            numericDuration,

          pricePerHour,

          totalPrice:
            calculatedTotalPrice,

          status:
            "Active",
        },
      });

    } catch (error) {

      // =====================================================
      // ROLLBACK
      // =====================================================

      if (connection) {

        try {

          await connection.rollback();

        } catch (rollbackError) {

          console.error(
            "Rollback error:",
            rollbackError
          );
        }
      }

      console.error(
        "Booking error:",
        error
      );

      return res.status(500).json({

        message:
          "Failed to create booking",

        error:
          error.message,
      });

    } finally {

      if (connection) {
        connection.release();
      }
    }
  }
);

// =========================================================
// CANCEL BOOKING
// =========================================================

app.put(
  "/api/bookings/:bookingId/cancel",
  authenticateToken,
  async (req, res) => {

    let connection;

    try {

      const {
        bookingId,
      } = req.params;

      console.log(
        "Cancelling booking:",
        bookingId
      );

      // =====================================================
      // CONNECTION
      // =====================================================

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      // =====================================================
      // FIND USER BOOKING
      // =====================================================

      const [bookings] =
        await connection.query(
          `
          SELECT
            id,
            booking_id,
            parking_id,
            booking_date,
            status

          FROM bookings

          WHERE booking_id = ?

          AND user_id = ?

          FOR UPDATE
          `,
          [
            bookingId,
            req.user.userId,
          ]
        );

      if (
        bookings.length === 0
      ) {

        await connection.rollback();

        return res.status(404).json({
          message:
            "Booking not found",
        });
      }

      const booking =
        bookings[0];

      // =====================================================
      // CHECK STATUS
      // =====================================================

      if (
        booking.status !==
        "Active"
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "This booking cannot be cancelled",
        });
      }

      // =====================================================
      // CANCEL BOOKING
      // =====================================================

      const [
        cancelResult,
      ] =
        await connection.query(
          `
          UPDATE bookings

          SET status = 'Cancelled'

          WHERE booking_id = ?

          AND user_id = ?

          AND status = 'Active'
          `,
          [
            bookingId,
            req.user.userId,
          ]
        );

      if (
        cancelResult.affectedRows !==
        1
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "Booking could not be cancelled",
        });
      }

      // =====================================================
      // COMMIT
      // =====================================================

      await connection.commit();

      console.log(
        "Booking cancelled successfully:",
        bookingId
      );

      return res.status(200).json({

        message:
          "Booking cancelled successfully",

        bookingId,

        status:
          "Cancelled",
      });

    } catch (error) {

      if (connection) {

        try {

          await connection.rollback();

        } catch (rollbackError) {

          console.error(
            "Rollback error:",
            rollbackError
          );
        }
      }

      console.error(
        "Cancel booking error:",
        error
      );

      return res.status(500).json({

        message:
          "Failed to cancel booking",

        error:
          error.message,
      });

    } finally {

      if (connection) {
        connection.release();
      }
    }
  }
);

// =========================================================
// SERVER
// =========================================================

const PORT =
  process.env.PORT || 5000;

app.listen(
  PORT,
  () => {

    console.log(
      `SmartKerb backend running on http://localhost:${PORT}`
    );
  }
);