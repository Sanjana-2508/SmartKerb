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
// =========================================================

app.get("/api/parking", async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT
        p.id,
        p.name,
        p.address,
        p.total_spots,

        COALESCE(
          d.available_spots,
          p.available_spots
        ) AS available_spots,

        p.price_per_hour,
        p.walking_time,
        p.rating,

        CASE
          WHEN COALESCE(
            d.available_spots,
            p.available_spots
          ) = 0
            THEN 'Full'

          WHEN COALESCE(
            d.available_spots,
            p.available_spots
          ) <= p.total_spots * 0.30
            THEN 'Limited'

          ELSE 'Available'
        END AS status,

        p.latitude,
        p.longitude

      FROM parking_locations p

      LEFT JOIN parking_daily_availability d
        ON p.id = d.parking_id
        AND d.availability_date = CURDATE()

      ORDER BY p.id
    `);

    res.json(rows);

  } catch (error) {

    console.error(
      "Parking fetch error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to fetch parking locations",

      error:
        error.message,
    });
  }
});

// =========================================================
// GET PARKING AVAILABILITY FOR A DATE
// =========================================================

app.get(
  "/api/parking/:parkingId/availability",
  async (req, res) => {
    try {
      const { parkingId } = req.params;
      const { date } = req.query;

      // -----------------------------------------------------
      // VALIDATION
      // -----------------------------------------------------

      if (!date) {
        return res.status(400).json({
          message: "Date is required",
        });
      }

      // -----------------------------------------------------
      // GET PARKING LOCATION
      // -----------------------------------------------------

      const [parkingRows] =
        await db.query(
          `SELECT
            id,
            total_spots,
            available_spots,
            status
          FROM parking_locations
          WHERE id = ?`,
          [parkingId]
        );

      if (parkingRows.length === 0) {
        return res.status(404).json({
          message:
            "Parking location not found",
        });
      }

      const parking =
        parkingRows[0];

      // -----------------------------------------------------
      // CHECK DAILY AVAILABILITY
      // -----------------------------------------------------

      const [availabilityRows] =
        await db.query(
          `SELECT
            available_spots
          FROM parking_daily_availability
          WHERE parking_id = ?
          AND availability_date = ?`,
          [
            parkingId,
            date,
          ]
        );

      // -----------------------------------------------------
      // CREATE DAILY AVAILABILITY IF NEEDED
      // -----------------------------------------------------

      if (
        availabilityRows.length === 0
      ) {
        await db.query(
          `INSERT INTO parking_daily_availability
          (
            parking_id,
            availability_date,
            available_spots
          )
          VALUES (?, ?, ?)`,
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
            parking.total_spots,

          totalSpots:
            parking.total_spots,
        });
      }

      // -----------------------------------------------------
      // RETURN EXISTING AVAILABILITY
      // -----------------------------------------------------

      res.json({
        parkingId:
          Number(parkingId),

        date,

        availableSpots:
          availabilityRows[0]
            .available_spots,

        totalSpots:
          parking.total_spots,
      });

    } catch (error) {
      console.error(
        "Availability fetch error:",
        error
      );

      res.status(500).json({
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

      // -----------------------------------------------------
      // VALIDATION
      // -----------------------------------------------------

      if (!phone || !password) {
        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          message:
            "Password must contain at least 6 characters",
        });
      }

      // -----------------------------------------------------
      // CHECK EXISTING USER
      // -----------------------------------------------------

      const [existingUsers] =
        await db.query(
          `SELECT id
           FROM users
           WHERE phone = ?`,
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

      // -----------------------------------------------------
      // HASH PASSWORD
      // -----------------------------------------------------

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      // -----------------------------------------------------
      // CREATE USER
      // -----------------------------------------------------

      await db.query(
        `INSERT INTO users
        (
          phone,
          password
        )
        VALUES (?, ?)`,
        [
          phone,
          hashedPassword,
        ]
      );

      res.status(201).json({
        message:
          "Account created successfully",
      });

    } catch (error) {
      console.error(
        "Signup error:",
        error
      );

      res.status(500).json({
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

      // -----------------------------------------------------
      // VALIDATION
      // -----------------------------------------------------

      if (!phone || !password) {
        return res.status(400).json({
          message:
            "Phone number and password are required",
        });
      }

      // -----------------------------------------------------
      // FIND USER
      // -----------------------------------------------------

      const [users] =
        await db.query(
          `SELECT
            id,
            phone,
            password
          FROM users
          WHERE phone = ?`,
          [phone]
        );

      if (users.length === 0) {
        return res.status(401).json({
          message:
            "Invalid phone number or password",
        });
      }

      const user =
        users[0];

      // -----------------------------------------------------
      // CHECK PASSWORD
      // -----------------------------------------------------

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

      // -----------------------------------------------------
      // CHECK JWT SECRET
      // -----------------------------------------------------

      if (!process.env.JWT_SECRET) {
        return res.status(500).json({
          message:
            "JWT_SECRET is missing from .env",
        });
      }

      // -----------------------------------------------------
      // CREATE JWT
      // -----------------------------------------------------

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

      // -----------------------------------------------------
      // RESPONSE
      // -----------------------------------------------------

      res.json({
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

      res.status(500).json({
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
          `SELECT
            b.id,
            b.booking_id,
            b.user_id,
            b.parking_id,
            b.booking_date,
            b.arrival_time,
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
            b.arrival_time DESC`,
          [req.user.userId]
        );

      res.status(200).json(
        rows
      );

    } catch (error) {
      console.error(
        "Fetch bookings error:",
        error
      );

      res.status(500).json({
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
          `SELECT
            b.id,
            b.booking_id,
            b.user_id,
            b.parking_id,
            b.booking_date,
            b.arrival_time,
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
            b.arrival_time DESC`,
          [req.user.userId]
        );

      res.status(200).json(
        rows
      );

    } catch (error) {
      console.error(
        "Fetch parking history error:",
        error
      );

      res.status(500).json({
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

      console.log("BOOKING REQUEST RECEIVED");
      console.log("User:", req.user);
      console.log("Body:", req.body);

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
          message: "All booking details are required",
        });
      }

      // =====================================================
      // VALIDATE DURATION
      // =====================================================

      const numericDuration = Number(duration);

      if (
        !Number.isFinite(numericDuration) ||
        numericDuration <= 0
      ) {
        return res.status(400).json({
          message: "Invalid parking duration",
        });
      }

      // =====================================================
      // GET DATABASE CONNECTION
      // =====================================================

      connection = await db.getConnection();

      // =====================================================
      // START TRANSACTION
      // =====================================================

      await connection.beginTransaction();

      // =====================================================
      // CHECK PARKING LOCATION
      // =====================================================

      const [parkingRows] =
        await connection.query(
          `SELECT
            id,
            total_spots,
            price_per_hour,
            status
          FROM parking_locations
          WHERE id = ?
          FOR UPDATE`,
          [parkingId]
        );

      if (parkingRows.length === 0) {

        await connection.rollback();

        return res.status(404).json({
          message: "Parking location not found",
        });
      }

      const parking = parkingRows[0];

      // =====================================================
      // CHECK PARKING STATUS
      // =====================================================

      if (
        parking.status &&
        parking.status.toLowerCase() === "closed"
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "This parking location is currently unavailable",
        });
      }

      // =====================================================
      // CALCULATE PRICE ON SERVER
      // =====================================================

      const pricePerHour =
        Number(parking.price_per_hour);

      if (
        !Number.isFinite(pricePerHour) ||
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
      // GET / CREATE DAILY AVAILABILITY
      // =====================================================

      let [availabilityRows] =
        await connection.query(
          `SELECT
            available_spots
          FROM parking_daily_availability
          WHERE parking_id = ?
          AND availability_date = ?
          FOR UPDATE`,
          [
            parkingId,
            bookingDate,
          ]
        );

      // =====================================================
      // CREATE DAILY AVAILABILITY IF NEEDED
      // =====================================================

      if (availabilityRows.length === 0) {

        await connection.query(
          `INSERT INTO parking_daily_availability
          (
            parking_id,
            availability_date,
            available_spots
          )
          VALUES (?, ?, ?)`,
          [
            parkingId,
            bookingDate,
            parking.total_spots,
          ]
        );

        // Read the newly-created row again
        [availabilityRows] =
          await connection.query(
            `SELECT
              available_spots
            FROM parking_daily_availability
            WHERE parking_id = ?
            AND availability_date = ?
            FOR UPDATE`,
            [
              parkingId,
              bookingDate,
            ]
          );
      }

      const availableSpots =
        Number(
          availabilityRows[0]
            .available_spots
        );

      // =====================================================
      // CHECK AVAILABILITY
      // =====================================================

      if (availableSpots <= 0) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "No parking spots are available for this date",
        });
      }

      // =====================================================
      // GENERATE UNIQUE BOOKING ID
      // =====================================================

      let bookingId;
      let bookingExists = true;

      while (bookingExists) {

        bookingId =
          "SK" +
          Math.floor(
            100000 +
            Math.random() * 900000
          );

        const [existing] =
          await connection.query(
            `SELECT id
             FROM bookings
             WHERE booking_id = ?`,
            [bookingId]
          );

        bookingExists =
          existing.length > 0;
      }

      // =====================================================
      // CREATE BOOKING
      // =====================================================

      await connection.query(
        `INSERT INTO bookings
        (
          booking_id,
          user_id,
          parking_id,
          booking_date,
          arrival_time,
          duration,
          total_price,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          req.user.userId,
          parkingId,
          bookingDate,
          arrivalTime,
          numericDuration,
          calculatedTotalPrice,
          "Active",
        ]
      );

      // =====================================================
      // REDUCE AVAILABILITY
      // =====================================================

      const [updateResult] =
        await connection.query(
          `UPDATE parking_daily_availability
           SET available_spots =
             available_spots - 1
           WHERE parking_id = ?
           AND availability_date = ?
           AND available_spots > 0`,
          [
            parkingId,
            bookingDate,
          ]
        );

      // =====================================================
      // SAFETY CHECK
      // =====================================================

      if (
        updateResult.affectedRows !== 1
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "No parking spots are available",
        });
      }

      // =====================================================
      // COMMIT TRANSACTION
      // =====================================================

      await connection.commit();

      console.log(
        "Booking created successfully:",
        bookingId
      );

      // =====================================================
      // SUCCESS RESPONSE
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

          arrivalTime,

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
      // ROLLBACK ON ERROR
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
      // GET DATABASE CONNECTION
      // =====================================================

      connection =
        await db.getConnection();

      // =====================================================
      // START TRANSACTION
      // =====================================================

      await connection.beginTransaction();

      // =====================================================
      // FIND USER'S BOOKING
      // =====================================================

      const [bookings] =
        await connection.query(
          `SELECT
            id,
            booking_id,
            parking_id,
            booking_date,
            status
          FROM bookings
          WHERE booking_id = ?
          AND user_id = ?
          FOR UPDATE`,
          [
            bookingId,
            req.user.userId,
          ]
        );

      // =====================================================
      // BOOKING NOT FOUND
      // =====================================================

      if (bookings.length === 0) {

        await connection.rollback();

        return res.status(404).json({
          message:
            "Booking not found",
        });
      }

      const booking =
        bookings[0];

      // =====================================================
      // CHECK BOOKING STATUS
      // =====================================================

      if (
        booking.status !== "Active"
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

      const [cancelResult] =
        await connection.query(
          `UPDATE bookings
           SET status = 'Cancelled'
           WHERE booking_id = ?
           AND user_id = ?
           AND status = 'Active'`,
          [
            bookingId,
            req.user.userId,
          ]
        );

      // =====================================================
      // SAFETY CHECK
      // =====================================================

      if (
        cancelResult.affectedRows !== 1
      ) {

        await connection.rollback();

        return res.status(400).json({
          message:
            "Booking could not be cancelled",
        });
      }

      // =====================================================
      // RESTORE PARKING SPOT
      // =====================================================

      const [restoreResult] =
        await connection.query(
          `UPDATE parking_daily_availability
           SET available_spots =
             available_spots + 1
           WHERE parking_id = ?
           AND availability_date = ?
           AND available_spots < (
             SELECT total_spots
             FROM parking_locations
             WHERE id = ?
           )`,
          [
            booking.parking_id,
            booking.booking_date,
            booking.parking_id,
          ]
        );

      // =====================================================
      // SAFETY CHECK FOR AVAILABILITY
      // =====================================================

      if (
        restoreResult.affectedRows !== 1
      ) {

        await connection.rollback();

        return res.status(500).json({
          message:
            "Booking was not cancelled because parking availability could not be restored",
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

      // =====================================================
      // SUCCESS
      // =====================================================

      return res.status(200).json({

        message:
          "Booking cancelled successfully",

        bookingId,

        status:
          "Cancelled",
      });

    } catch (error) {

      // =====================================================
      // ROLLBACK ON ERROR
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