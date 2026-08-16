import { useEffect, useState } from "react";
import "./App.css";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",

  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",

  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const createParkingIcon = (status) => {
  let background = "#3f7d4c";

  if (status === "Limited") {
    background = "#d89b28";
  }

  if (status === "Full") {
    background = "#c0392b";
  }

  return L.divIcon({
    className: "custom-parking-marker",

    html: `
      <div
        style="
          width: 36px;
          height: 36px;
          border-radius: 50% 50% 50% 0;
          background: ${background};
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
          border: 3px solid white;
        "
      >
        <span
          style="
            transform: rotate(45deg);
            color: white;
            font-weight: 800;
            font-size: 15px;
          "
        >
          P
        </span>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
};

function App() {
  const [page, setPage] = useState("welcome");

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const [selectedParking, setSelectedParking] = useState(null);
  const [booking, setBooking] = useState(null);

  // =========================================================
  // RESERVATION STATE
  // =========================================================

  const [bookingDate, setBookingDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("10:30");
  const [duration, setDuration] = useState("1");

  // Availability for the currently selected date
  const [selectedDateAvailability, setSelectedDateAvailability] =
    useState(null);

  const [search, setSearch] = useState("");

  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [nearMeActive, setNearMeActive] = useState(false);

  const [bookings, setBookings] = useState([]);
  const [history, setHistory] = useState([]);

  const [parkingSpots, setParkingSpots] = useState([]);

  // =========================================================
  // GET TODAY'S DATE
  // =========================================================

  const getTodayDate = () => {
    const today = new Date();

    return `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
  };

  // =========================================================
  // FORMAT DATE FOR DISPLAY
  // =========================================================

  const formatDisplayDate = (dateString) => {
    if (!dateString) {
      return "";
    }

    const date = new Date(`${dateString}T00:00:00`);

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // =========================================================
  // FETCH PARKING DATA
  // =========================================================

  useEffect(() => {
    fetch("http://localhost:5000/api/parking")
      .then((response) => {
                if (!response.ok) {
                  throw new Error("Failed to fetch parking data");
                }

                return response.json();
              })
              .then(async (data) => {
          const today = getTodayDate();

          const formattedParking = await Promise.all(
            data.map(async (parking) => {
              let available = Number(parking.available_spots);

              try {
                const response = await fetch(
                  `http://localhost:5000/api/parking/${parking.id}/availability?date=${today}`
                );

                if (response.ok) {
                  const availability = await response.json();

                  available = Number(
                    availability.availableSpots
                  );
                }
              } catch (error) {
                console.error(
                  `Availability error for ${parking.name}:`,
                  error
                );
              }

              return {
                id: parking.id,
                name: parking.name,
                address: parking.address,
                available: available,
                total: Number(parking.total_spots),
                price: Number(parking.price_per_hour),
                walk: parking.walking_time,
                rating: Number(parking.rating),
                status:
                  available === 0
                    ? "Full"
                    : available <= 5
                    ? "Limited"
                    : "Available",

                latitude: Number(parking.latitude),
                longitude: Number(parking.longitude),
              };
            })
          );

          setParkingSpots(formattedParking);
        })

      .catch((error) => {
        console.error("Error fetching parking:", error);
      });
  }, []);

  // =========================================================
  // FETCH DATE-SPECIFIC AVAILABILITY
  // =========================================================

  useEffect(() => {
    if (!selectedParking || !bookingDate) {
      return;
    }

    const fetchAvailability = async () => {
      try {
        const response = await fetch(
          `http://localhost:5000/api/parking/${selectedParking.id}/availability?date=${bookingDate}`
        );

        const data = await response.json();

        if (!response.ok) {
          console.error(
            "Availability error:",
            data.message
          );

          setSelectedDateAvailability(null);

          return;
        }

        setSelectedDateAvailability(data);
      } catch (error) {
        console.error(
          "Failed to fetch availability:",
          error
        );

        setSelectedDateAvailability(null);
      }
    };

    fetchAvailability();
  }, [selectedParking, bookingDate]);

  // =========================================================
  // CREATE ACCOUNT
  // =========================================================

  const createAccount = async () => {
    const cleanPhone = phone.trim();

    if (!cleanPhone) {
      alert("Please enter your phone number.");
      return;
    }

    if (password.length < 6) {
      alert("Password must contain at least 6 characters.");
      return;
    }

    try {
      const response = await fetch(
        "http://localhost:5000/api/auth/signup",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            phone: cleanPhone,
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to create account."
        );

        return;
      }

      alert("Account created successfully!");

      setPhone("");
      setPassword("");

      setPage("login");
    } catch (error) {
      console.error("Signup error:", error);

      alert("Unable to connect to the server.");
    }
  };

  // =========================================================
  // LOGIN
  // =========================================================

  const login = async () => {
    const cleanPhone = phone.trim();

    if (!cleanPhone || !password) {
      alert(
        "Please enter your phone number and password."
      );

      return;
    }

    try {
      const response = await fetch(
        "http://localhost:5000/api/auth/login",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            phone: cleanPhone,
            password: password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Login failed."
        );

        return;
      }

      localStorage.setItem(
        "smartkerbToken",
        data.token
      );

      if (data.user) {
        localStorage.setItem(
          "smartkerbUser",
          JSON.stringify(data.user)
        );
      }

      setPhone("");
      setPassword("");

      setPage("dashboard");
    } catch (error) {
      console.error("Login error:", error);

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // LOGOUT
  // =========================================================

  const logout = () => {
    localStorage.removeItem(
      "smartkerbToken"
    );

    localStorage.removeItem(
      "smartkerbUser"
    );

    setPhone("");
    setPassword("");

    setSelectedParking(null);
    setBooking(null);

    setBookings([]);
    setHistory([]);

    setBookingDate("");
    setArrivalTime("10:30");
    setDuration("1");

    setSelectedDateAvailability(null);

    setPage("welcome");
  };

  // =========================================================
  // FETCH MY BOOKINGS
  // =========================================================

  const fetchBookings = async () => {
    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      const response = await fetch(
        "http://localhost:5000/api/bookings",
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Failed to fetch bookings:",
          data.message
        );

        return;
      }

      const formattedBookings = data.map(
        (item) => ({
          bookingId: item.booking_id,

          name: item.name,

          address: item.address,

          date: item.booking_date,

          arrivalTime: item.arrival_time,

          duration: Number(
            item.duration
          ),

          totalPrice: Number(
            item.total_price
          ),

          status: item.status,

          parkingId: item.parking_id,

          available: item.available_spots,

          total: item.total_spots,

          price: item.price_per_hour,

          walk: item.walking_time,

          rating: item.rating,
        })
      );

      setBookings(
        formattedBookings
      );
    } catch (error) {
      console.error(
        "Error fetching bookings:",
        error
      );
    }
  };

  // =========================================================
  // FETCH PARKING HISTORY
  // =========================================================

  const fetchHistory = async () => {
    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      const response = await fetch(
        "http://localhost:5000/api/bookings/history",
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Failed to fetch parking history:",
          data.message
        );

        return;
      }

      const formattedHistory = data.map(
        (item) => ({
          bookingId: item.booking_id,

          name: item.name,

          address: item.address,

          date: item.booking_date,

          arrivalTime: item.arrival_time,

          duration: Number(
            item.duration
          ),

          totalPrice: Number(
            item.total_price
          ),

          status: item.status,

          parkingId: item.parking_id,

          available: item.available_spots,

          total: item.total_spots,

          price: item.price_per_hour,

          walk: item.walking_time,

          rating: item.rating,
        })
      );

      setHistory(
        formattedHistory
      );
    } catch (error) {
      console.error(
        "Error fetching parking history:",
        error
      );
    }
  };

  // =========================================================
  // OPEN PARKING DETAILS
  // =========================================================

  const openParkingDetails = (parking) => {
    const today = getTodayDate();

    setSelectedParking(parking);

    setBookingDate(today);

    setArrivalTime("10:30");

    setDuration("1");

    setSelectedDateAvailability(null);

    setPage("parkingDetails");
  };

  // =========================================================
  // RESERVE PARKING
  // =========================================================

  const reserveSpot = async () => {
    if (!selectedParking) {
      return;
    }

    // -------------------------------------------------------
    // VALIDATE DATE
    // -------------------------------------------------------

    if (!bookingDate) {
      alert(
        "Please select a parking date."
      );

      return;
    }

    // -------------------------------------------------------
    // VALIDATE TIME
    // -------------------------------------------------------

    if (!arrivalTime) {
      alert(
        "Please select your arrival time."
      );

      return;
    }

    // -------------------------------------------------------
    // VALIDATE DURATION
    // -------------------------------------------------------

    const hours = Number(duration);

    if (
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      alert(
        "Please select a valid parking duration."
      );

      return;
    }

    // -------------------------------------------------------
    // CHECK DATE-SPECIFIC AVAILABILITY
    // -------------------------------------------------------

    if (
      selectedDateAvailability &&
      Number(
        selectedDateAvailability.availableSpots
      ) <= 0
    ) {
      alert(
        "No parking spots are available for the selected date."
      );

      return;
    }

    // -------------------------------------------------------
    // CALCULATE PRICE
    // -------------------------------------------------------

    const totalPrice =
      Number(selectedParking.price) *
      hours;

    // -------------------------------------------------------
    // GET TOKEN
    // -------------------------------------------------------

    const token = localStorage.getItem(
      "smartkerbToken"
    );

    if (!token) {
      alert("Please login again.");

      setPage("login");

      return;
    }

    try {
      // -----------------------------------------------------
      // SEND BOOKING TO BACKEND
      // -----------------------------------------------------

      const response = await fetch(
        "http://localhost:5000/api/bookings",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`,
          },

          body: JSON.stringify({
            parkingId:
              selectedParking.id,

            bookingDate:
              bookingDate,

            arrivalTime:
              arrivalTime,

            duration:
              hours,

            totalPrice:
              totalPrice,
          }),
        }
      );

      const data =
        await response.json();

      // -----------------------------------------------------
      // HANDLE ERROR
      // -----------------------------------------------------

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to create booking."
        );

        return;
      }

      // -----------------------------------------------------
      // UPDATE LOCAL AVAILABILITY
      // -----------------------------------------------------

      const newAvailableSpots =
        selectedDateAvailability
          ? Math.max(
              0,
              Number(
                selectedDateAvailability.availableSpots
              ) - 1
            )
          : Math.max(
              0,
              Number(
                selectedParking.available
              ) - 1
            );

      setSelectedDateAvailability(
        (prev) =>
          prev
            ? {
                ...prev,

                availableSpots:
                  newAvailableSpots,
              }
            : {
                parkingId:
                  selectedParking.id,

                date:
                  bookingDate,

                availableSpots:
                  newAvailableSpots,

                totalSpots:
                  selectedParking.total,
              }
      );

      // -----------------------------------------------------
      // UPDATE PARKING CARD LOCALLY
      // -----------------------------------------------------

      setParkingSpots(
        (prev) =>
          prev.map((parking) =>
            parking.id ===
            selectedParking.id
              ? {
                  ...parking,

                  available:
                    Math.max(
                      0,
                      Number(
                        parking.available
                      ) - 1
                    ),
                }
              : parking
          )
      );

      // -----------------------------------------------------
      // UPDATE SELECTED PARKING
      // -----------------------------------------------------

      const updatedParking = {
        ...selectedParking,

        available:
          newAvailableSpots,
      };

      setSelectedParking(
        updatedParking
      );

      // -----------------------------------------------------
      // CREATE FRONTEND BOOKING OBJECT
      // -----------------------------------------------------

      const newBooking = {
        ...updatedParking,

        bookingId:
          data.bookingId,

        date:
          formatDisplayDate(
            bookingDate
          ),

        bookingDate:
          bookingDate,

        arrivalTime:
          arrivalTime,

        duration:
          hours,

        totalPrice:
          totalPrice,

        status:
          "Active",
      };

      // -----------------------------------------------------
      // UPDATE BOOKING STATE
      // -----------------------------------------------------

      setBooking(
        newBooking
      );

      setBookings(
        (prev) => [
          newBooking,
          ...prev,
        ]
      );

      // -----------------------------------------------------
      // SHOW CONFIRMATION
      // -----------------------------------------------------

      setPage(
        "bookingConfirmed"
      );
    } catch (error) {
      console.error(
        "Booking error:",
        error
      );

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // CANCEL BOOKING
  // =========================================================

  const cancelBooking = async (
    bookingToCancel = booking
  ) => {
    if (!bookingToCancel) {
      return;
    }

    const confirmCancel =
      window.confirm(
        "Are you sure you want to cancel this reservation?"
      );

    if (!confirmCancel) {
      return;
    }

    const token =
      localStorage.getItem(
        "smartkerbToken"
      );

    if (!token) {
      alert(
        "Please login again."
      );

      setPage("login");

      return;
    }

    try {
      const response =
        await fetch(
          `http://localhost:5000/api/bookings/${bookingToCancel.bookingId}/cancel`,
          {
            method: "PUT",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            "Failed to cancel booking."
        );

        return;
      }

      // -----------------------------------------------------
      // UPDATE LOCAL BOOKING
      // -----------------------------------------------------

      const cancelledBooking = {
        ...bookingToCancel,

        status:
          "Cancelled",
      };

      // -----------------------------------------------------
      // REMOVE FROM ACTIVE BOOKINGS
      // -----------------------------------------------------

      setBookings(
        (prev) =>
          prev.filter(
            (item) =>
              item.bookingId !==
              bookingToCancel.bookingId
          )
      );

      // -----------------------------------------------------
      // ADD TO HISTORY
      // -----------------------------------------------------

      setHistory(
        (prev) => [
          cancelledBooking,
          ...prev,
        ]
      );

      // -----------------------------------------------------
      // RESTORE LOCAL PARKING COUNT
      // -----------------------------------------------------

      setParkingSpots(
        (prev) =>
          prev.map((parking) =>
            parking.id ===
            bookingToCancel.parkingId
              ? {
                  ...parking,

                  available:
                    Math.min(
                      Number(
                        parking.total
                      ),
                      Number(
                        parking.available
                      ) + 1
                    ),
                }
              : parking
          )
      );

      // -----------------------------------------------------
      // RESTORE SELECTED DATE AVAILABILITY
      // -----------------------------------------------------

      if (
        bookingToCancel.parkingId &&
        bookingToCancel.date
      ) {
        setSelectedDateAvailability(
          (prev) =>
            prev
              ? {
                  ...prev,

                  availableSpots:
                    Math.min(
                      Number(
                        prev.totalSpots
                      ),

                      Number(
                        prev.availableSpots
                      ) + 1
                    ),
                }
              : prev
        );
      }

      setBooking(null);
      setSelectedParking(null);

      alert(
        "Reservation cancelled successfully."
      );

      setPage("dashboard");
    } catch (error) {
      console.error(
        "Cancel booking error:",
        error
      );

      alert(
        "Unable to connect to the server."
      );
    }
  };

  // =========================================================
  // GO TO DASHBOARD
  // =========================================================

  const goToDashboard = () => {
    setSelectedParking(null);

    setSelectedDateAvailability(
      null
    );

    setPage("dashboard");
  };
  
  const calculateDistance = (
    lat1,
    lon1,
    lat2,
    lon2
  ) => {
    const R = 6371;

    const dLat =
      ((lat2 - lat1) * Math.PI) / 180;

    const dLon =
      ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
      Math.cos(
        (lat1 * Math.PI) / 180
      ) *
        Math.cos(
          (lat2 * Math.PI) / 180
        ) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );

    return R * c;
  };

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      alert(
        "Location services are not supported by your browser."
      );

      return;
    }

    setLocationLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        console.log(
          "User location:",
          location
        );

        setUserLocation(location);
        setNearMeActive(true);
        setLocationLoading(false);
      },

      (error) => {
        console.error(
          "Location error:",
          error
        );

        setLocationLoading(false);

        if (error.code === 1) {
          alert(
            "Location permission was denied. Please allow location access in your browser."
          );
        } else if (error.code === 2) {
          alert(
            "Your location could not be determined."
          );
        } else if (error.code === 3) {
          alert(
            "Location request timed out. Please try again."
          );
        } else {
          alert(
            "Unable to access your location."
          );
        }
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  // =========================================================
  // CALCULATE DISTANCE FROM USER
  // =========================================================

  const parkingWithDistance =
    parkingSpots.map((parking) => {
      if (
        !userLocation ||
        parking.latitude == null ||
        parking.longitude == null
      ) {
        return {
          ...parking,
          distance: null,
        };
      }

      const distance =
        calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          parking.latitude,
          parking.longitude
        );

      return {
        ...parking,
        distance,
      };
    });

  // =========================================================
  // FILTER PARKING
  // =========================================================

    const filteredParking =
      parkingWithDistance
        .filter((parking) => {
          const matchesSearch =
            parking.name
              .toLowerCase()
              .includes(search.toLowerCase()) ||
            parking.address
              .toLowerCase()
              .includes(search.toLowerCase());

          if (!matchesSearch) {
            return false;
          }

          // When Near Me is active,
          // only show parking within 10 km.
          if (
            nearMeActive &&
            parking.distance != null
          ) {
            return parking.distance <= 10;
          }

          return true;
        })
        .sort((a, b) => {
          if (
            nearMeActive &&
            a.distance != null &&
            b.distance != null
          ) {
            return a.distance - b.distance;
          }

          return 0;
        });

  // =========================================================
  // DASHBOARD STATS
  // =========================================================

  const totalAvailableSpots =
    parkingSpots.reduce(
      (total, parking) =>
        total +
        Number(
          parking.available || 0
        ),

      0
    );

  const totalParkingZones =
    parkingSpots.length;

  // =========================================================
  // SMART RECOMMENDATION
  // =========================================================

  const recommendedParking =
    parkingWithDistance
      .filter((parking) => {
        // Only recommend parking with available spots
        if (Number(parking.available || 0) <= 0) {
          return false;
        }

        // If user has activated Near Me,
        // don't recommend something more than 10 km away.
        if (
          nearMeActive &&
          parking.distance != null &&
          parking.distance > 10
        ) {
          return false;
        }

        return true;
      })
      .map((parking) => {

        // =====================================================
        // DISTANCE SCORE
        // =====================================================

        let distanceScore = 0;

        if (
          nearMeActive &&
          parking.distance != null
        ) {
          // Closer parking gets a higher score.
          distanceScore =
            Math.max(
              0,
              10 - parking.distance
            );
        }

        // =====================================================
        // AVAILABILITY SCORE
        // =====================================================

        const availabilityScore =
          Math.min(
            Number(parking.available || 0),
            10
          );

        // =====================================================
        // RATING SCORE
        // =====================================================

        const ratingScore =
          Number(parking.rating || 0);

        // =====================================================
        // PRICE SCORE
        // =====================================================

        const priceScore =
          Math.max(
            0,
            10 - Number(parking.price || 0) / 10
          );

        // =====================================================
        // FINAL SMART SCORE
        // =====================================================

        const smartScore =
          nearMeActive
            ? (
                distanceScore * 0.45 +
                availabilityScore * 0.30 +
                ratingScore * 0.15 +
                priceScore * 0.10
              )
            : (
                availabilityScore * 0.45 +
                ratingScore * 0.25 +
                priceScore * 0.30
              );

        return {
          ...parking,
          smartScore,
        };
      })
      .sort(
        (a, b) =>
          b.smartScore -
          a.smartScore
      )[0];

  // =========================================================
  // AUTH PAGES
  // =========================================================

  if (
    page === "welcome" ||
    page === "login" ||
    page === "signup"
  ) {
    return (
      <div className="auth-page">

        {/* LEFT SECTION */}

        <div className="auth-left">

          <div className="brand">

            <div className="brand-icon">
              P
            </div>

            <span>
              SmartKerb
            </span>

          </div>

          <div className="hero-content">

            <p className="eyebrow">
              SMART PARKING • REAL TIME
            </p>

            <h1>
              Parking made
              <br />

              <span>
                smarter.
              </span>
            </h1>

            <p>
              Find, reserve and manage
              street parking without the
              hassle of driving around
              looking for a spot.
            </p>

          </div>

          <div className="bottom-text">
            Smart and Effective Real-Time
            Management of Street Parking
          </div>

        </div>

        {/* RIGHT SECTION */}

        <div className="auth-right">

          {/* WELCOME */}

          {page === "welcome" && (
            <div className="auth-card">

              <div className="mobile-brand">

                <div className="brand-icon">
                  P
                </div>

                <span>
                  SmartKerb
                </span>

              </div>

              <p className="card-eyebrow">
                WELCOME TO SMARTKERB
              </p>

              <h2>
                Park smarter.
              </h2>

              <p className="subtitle">
                Your parking spot is
                just a few taps away.
              </p>

              <button
                className="primary-btn"
                onClick={() =>
                  setPage("login")
                }
              >
                Login
              </button>

              <button
                className="secondary-btn"
                onClick={() =>
                  setPage("signup")
                }
              >
                Create Account
              </button>

            </div>
          )}

          {/* LOGIN */}

          {page === "login" && (
            <div className="auth-card">

              <button
                className="back-btn"
                onClick={() =>
                  setPage("welcome")
                }
              >
                ← Back
              </button>

              <p className="card-eyebrow">
                WELCOME BACK
              </p>

              <h2>
                Login
              </h2>

              <p className="subtitle">
                Enter your phone number
                and password.
              </p>

              <div className="form-group">

                <label>
                  Phone Number
                </label>

                <input
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) =>
                    setPhone(
                      e.target.value
                    )
                  }
                />

              </div>

              <div className="form-group">

                <label>
                  Password
                </label>

                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                />

              </div>

              <button
                className="primary-btn"
                onClick={login}
              >
                Login
              </button>

              <p className="switch-text">

                Don't have an account?

                <button
                  onClick={() => {
                    setPhone("");
                    setPassword("");
                    setPage("signup");
                  }}
                >
                  Create account
                </button>

              </p>

            </div>
          )}

          {/* SIGNUP */}

          {page === "signup" && (
            <div className="auth-card">

              <button
                className="back-btn"
                onClick={() =>
                  setPage("welcome")
                }
              >
                ← Back
              </button>

              <p className="card-eyebrow">
                CREATE ACCOUNT
              </p>

              <h2>
                Let's get started.
              </h2>

              <p className="subtitle">
                Create your SmartKerb
                account using your
                phone number.
              </p>

              <div className="form-group">

                <label>
                  Phone Number
                </label>

                <input
                  type="tel"
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) =>
                    setPhone(
                      e.target.value
                    )
                  }
                />

              </div>

              <div className="form-group">

                <label>
                  Create Password
                </label>

                <input
                  type="password"
                  placeholder="Create password"
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                />

              </div>

              <button
                className="primary-btn"
                onClick={createAccount}
              >
                Create Account
              </button>

              <p className="switch-text">

                Already have an account?

                <button
                  onClick={() => {
                    setPhone("");
                    setPassword("");
                    setPage("login");
                  }}
                >
                  Login
                </button>

              </p>

            </div>
          )}

        </div>

      </div>
    );
  }

  // =========================================================
  // MAIN APP
  // =========================================================

  return (
    <div className="app">

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <header className="dashboard-nav">

        <div className="dashboard-logo">

          <div className="brand-icon">
            P
          </div>

          <span>
            SmartKerb
          </span>

        </div>

        <nav className="dashboard-menu">

          <button
            className={
              page === "dashboard"
                ? "active-nav"
                : ""
            }
            onClick={goToDashboard}
          >
            Dashboard
          </button>

          <button
            className={
              page === "myBookings"
                ? "active-nav"
                : ""
            }
            onClick={() => {
              fetchBookings();
              setPage("myBookings");
            }}
          >
            My Bookings
          </button>

          <button
            className={
              page === "history"
                ? "active-nav"
                : ""
            }
            onClick={() => {
              fetchHistory();
              setPage("history");
            }}
          >
            Parking History
          </button>

        </nav>

        <div className="dashboard-profile">

          <span className="notification">
            •
          </span>

          <div className="avatar">
            R
          </div>

          <button
            className="logout-dashboard"
            onClick={logout}
          >
            Logout
          </button>

        </div>

      </header>

      {/* =====================================================
          DASHBOARD
      ===================================================== */}

      {page === "dashboard" && (
        <main className="dashboard-main">

          <section className="dashboard-welcome">

            <p className="dashboard-label">
              SMART PARKING • LIVE
            </p>

            <h1>
              Find your perfect
              <br />

              <span>
                parking spot.
              </span>
            </h1>

            <p>
              Real-time parking
              availability around you.
            </p>

          </section>

          {/* SEARCH */}

          <section className="parking-search">

            <div className="search-input">

              <span>
                ⌕
              </span>

              <input
                type="text"
                placeholder="Search parking location..."
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
              />

            </div>

            <button
              className="near-me-btn"
              onClick={handleNearMe}
            >
              {locationLoading
                ? "Locating..."
                : nearMeActive
                ? "Near Me ✓"
                : "Near Me"}
            </button>

          </section>

          {/* STATS */}

          <section className="dashboard-stats">

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot green"></span>

              </div>

              <div>

                <h3>
                  {totalAvailableSpots}
                </h3>

                <p>
                  Available spots
                </p>

              </div>

            </div>

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot yellow"></span>

              </div>

              <div>

                <h3>
                  {totalParkingZones}
                </h3>

                <p>
                  Parking zones
                </p>

              </div>

            </div>

            <div className="dashboard-stat">

              <div className="stat-symbol">

                <span className="status-dot green"></span>

              </div>

              <div>

                <h3>
                  LIVE
                </h3>

                <p>
                  Availability
                </p>

              </div>

            </div>

          </section>

          {/* RECOMMENDATION */}

          <section className="smart-recommendation">

            <div className="recommendation-star">
              ✦
            </div>

            <div className="recommendation-content">

              <small>
                SMART RECOMMENDATION
              </small>

              <h3>
                {recommendedParking
                  ? `${recommendedParking.name} is your best match`
                  : "No parking currently available"}
              </h3>

              <p>
                {recommendedParking
                  ? nearMeActive &&
                    recommendedParking.distance != null
                    ? `${recommendedParking.distance.toFixed(
                        1
                      )} km away • ${
                        recommendedParking.available
                      } spots available • ₹${
                        recommendedParking.price
                      }/hour • ⭐ ${
                        recommendedParking.rating
                      }`
                    : `${
                        recommendedParking.available
                      } spots available • ₹${
                        recommendedParking.price
                      }/hour • ⭐ ${
                        recommendedParking.rating
                      }`
                  : "Please check again shortly for available parking."}
              </p>

            </div>

            <div className="match">

              <strong>
                {recommendedParking
                  ? "BEST"
                  : "--"}
              </strong>

              <span>
                Match
              </span>

            </div>

          </section>

          {/* PARKING */}

          <section className="parking-section">

            <div className="parking-section-header">

              <div>

                <h2>
                  Nearby parking
                </h2>

                <p>
                  Parking availability
                  updated in real time
                </p>

              </div>

              <button
                className="view-map-btn"
                onClick={() => {
                  document
                    .getElementById("live-parking-map")
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                }}
              >
                View Map →
              </button>

            </div>

            {filteredParking.length === 0 ? (

              <div className="no-results">
                {nearMeActive
                  ? "No parking locations found within 10 km of your current location."
                  : "No parking location found."}
              </div>

            ) : (

              <div className="parking-cards">

                {filteredParking.map(
                  (parking) => (

                    <div
                      className="parking-card"
                      key={parking.id}
                    >

                      <div className="parking-card-header">

                        <div className="parking-place-icon">
                          P
                        </div>

                        <span
                          className={
                            parking.status ===
                            "Available"
                              ? "available-tag"
                              : "limited-tag"
                          }
                        >

                          <span
                            className={
                              parking.status ===
                              "Available"
                                ? "status-dot green"
                                : "status-dot yellow"
                            }
                          />

                          {parking.status}

                        </span>

                      </div>

                      <h3>
                        {parking.name}
                      </h3>

                      <p className="parking-address">
                        {parking.address}
                      </p>

                      <div className="parking-info">

                        <div>

                          <strong>
                            {parking.available}
                          </strong>

                          <span>
                            / {parking.total} spots
                          </span>

                        </div>

                        <div>

                          <strong>
                            ₹{parking.price}
                          </strong>

                          <span>
                            / hour
                          </span>

                        </div>

                      </div>

                      <div className="parking-bottom">

                        <span>
                          {nearMeActive &&
                          parking.distance != null
                            ? `${parking.distance.toFixed(1)} km away`
                            : `${parking.walk} walk`}
                        </span>

                        <span>
                          {parking.rating} rating
                        </span>
                        
                      </div>

                      <button
                        className="parking-view-btn"
                        onClick={() =>
                          openParkingDetails(
                            parking
                          )
                        }
                      >
                        View Parking
                      </button>

                    </div>

                  )
                )}

              </div>

            )}

          </section>

          {/* MAP */}

          <section
            className="live-map-section"
            id="live-parking-map"
          >

              <div className="parking-section-header">

                <div>

                  <h2>
                    Live parking map
                  </h2>

                  <p>
                    Monitor parking availability
                    across Bengaluru
                  </p>

                </div>

              </div>

              <div className="real-map-wrapper">

                <MapContainer
                  center={[12.9716, 77.5946]}
                  zoom={12}
                  scrollWheelZoom={true}
                  className="real-map"
                >

                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {userLocation && (
                    <CircleMarker
                      center={[
                        userLocation.latitude,
                        userLocation.longitude,
                      ]}
                      radius={10}
                      pathOptions={{
                        color: "#2563eb",
                        fillColor: "#2563eb",
                        fillOpacity: 0.8,
                      }}
                    >
                      <Popup>
                        <strong>
                          You are here
                        </strong>
                      </Popup>
                    </CircleMarker>
                  )}

                  {parkingSpots
                    .filter(
                      (parking) =>
                        Number.isFinite(parking.latitude) &&
                        Number.isFinite(parking.longitude)
                    )
                    .map((parking) => (

                      <Marker
                        key={parking.id}
                        position={[
                          parking.latitude,
                          parking.longitude,
                        ]}
                        icon={createParkingIcon(
                          parking.status
                        )}
                      >

                        <Popup>

                          <div className="parking-popup">

                            <h3>
                              {parking.name}
                            </h3>

                            <p>
                              {parking.address}
                            </p>

                            <div className="popup-availability">

                              <strong>
                                {parking.available}
                              </strong>

                              <span>
                                / {parking.total} spots
                              </span>

                            </div>

                            <p>
                              ₹{parking.price}/hour
                            </p>

                            <p>
                              ⭐ {parking.rating}
                            </p>

                            <button
                              className="popup-book-btn"
                              onClick={() =>
                                openParkingDetails(
                                  parking
                                )
                              }
                            >
                              View Parking
                            </button>

                          </div>

                        </Popup>

                      </Marker>

                    ))}

                </MapContainer>

                <div className="map-legend">

                  <span>
                    <span className="status-dot green" />
                    Available
                  </span>

                  <span>
                    <span className="status-dot yellow" />
                    Limited
                  </span>

                  <span>
                    <span className="status-dot red" />
                    Full
                  </span>

                </div>

              </div>

            </section>

          <button
            className="dashboard-logout-bottom"
            onClick={logout}
          >
            Logout from SmartKerb
          </button>

        </main>
      )}

      {/* =====================================================
          PARKING DETAILS / RESERVATION
      ===================================================== */}

      {page === "parkingDetails" &&
        selectedParking && (

          <div className="details-page-wrapper">

            <main className="parking-details-page">

              <button
                className="back-btn"
                onClick={goToDashboard}
                style={{
                  marginBottom:
                    "20px",
                }}
              >
                ← Back to Dashboard
              </button>

              <h2>
                RESERVE YOUR SPOT
              </h2>

              <div className="reservation-section">

                <h3>
                  Select your parking details
                </h3>

                <p>
                  Choose your parking date,
                  arrival time and how long
                  you want to park.
                </p>

                {/* =================================================
                    PARKING DATE
                ================================================= */}

                <div
                  style={{
                    marginBottom:
                      "20px",
                  }}
                >

                  <label
                    style={{
                      display:
                        "block",

                      marginBottom:
                        "10px",

                      fontSize:
                        "13px",

                      fontWeight:
                        "700",

                      color:
                        "#2d342f",
                    }}
                  >
                    Parking date
                  </label>

                  <div className="arrival-time-box">

                    <input
                      type="date"
                      value={
                        bookingDate
                      }
                      min={
                        getTodayDate()
                      }
                      onChange={(e) => {
                        setBookingDate(
                          e.target.value
                        );

                        setSelectedDateAvailability(
                          null
                        );
                      }}
                    />

                    <span className="arrival-time-icon">
                      📅
                    </span>

                  </div>

                </div>

                {/* =================================================
                    DATE AVAILABILITY
                ================================================= */}

                <div
                  style={{
                    marginBottom:
                      "20px",

                    padding:
                      "14px 16px",

                    borderRadius:
                      "12px",

                    background:
                      "#f4f7f3",

                    border:
                      "1px solid #dce5db",
                  }}
                >

                  <div
                    style={{
                      fontSize:
                        "12px",

                      fontWeight:
                        "700",

                      color:
                        "#6c756e",

                      marginBottom:
                        "5px",
                    }}
                  >
                    AVAILABILITY FOR
                  </div>

                  <div
                    style={{
                      fontSize:
                        "15px",

                      fontWeight:
                        "700",

                      color:
                        "#2d342f",
                    }}
                  >
                    {formatDisplayDate(
                      bookingDate
                    )}
                  </div>

                  <div
                    style={{
                      marginTop:
                        "8px",

                      fontSize:
                        "14px",

                      fontWeight:
                        "600",

                      color:
                        selectedDateAvailability &&
                        Number(
                          selectedDateAvailability.availableSpots
                        ) === 0
                          ? "#c0392b"
                          : "#3f7d4c",
                    }}
                  >

                    {selectedDateAvailability
                      ? `${selectedDateAvailability.availableSpots} of ${selectedDateAvailability.totalSpots} spots available`
                      : "Checking availability..."}

                  </div>

                </div>

                {/* =================================================
                    ARRIVAL TIME
                ================================================= */}

                <div
                  style={{
                    marginBottom:
                      "20px",
                  }}
                >

                  <label
                    style={{
                      display:
                        "block",

                      marginBottom:
                        "10px",

                      fontSize:
                        "13px",

                      fontWeight:
                        "700",

                      color:
                        "#2d342f",
                    }}
                  >
                    Arrival time
                  </label>

                  <div className="arrival-time-box">

                    <select
                      value={
                        arrivalTime
                      }
                      onChange={(e) =>
                        setArrivalTime(
                          e.target.value
                        )
                      }
                    >

                      {Array.from(
                        {
                          length: 48,
                        },

                        (_, i) => {

                          const hour =
                            Math.floor(
                              i / 2
                            );

                          const minute =
                            (i % 2) *
                            30;

                          const hourStr =
                            hour
                              .toString()
                              .padStart(
                                2,
                                "0"
                              );

                          const minuteStr =
                            minute
                              .toString()
                              .padStart(
                                2,
                                "0"
                              );

                          const timeStr =
                            `${hourStr}:${minuteStr}`;

                          const displayHour =
                            hour ===
                            0
                              ? 12
                              : hour >
                                12
                              ? hour -
                                12
                              : hour;

                          const ampm =
                            hour >=
                            12
                              ? "PM"
                              : "AM";

                          const displayTime =
                            `${displayHour}:${minuteStr} ${ampm}`;

                          return (
                            <option
                              key={
                                timeStr
                              }
                              value={
                                timeStr
                              }
                            >
                              {
                                displayTime
                              }
                            </option>
                          );
                        }
                      )}

                    </select>

                    <span className="arrival-time-icon">
                      🕐
                    </span>

                  </div>

                </div>

                {/* =================================================
                    DURATION
                ================================================= */}

                <label className="duration-label">
                  Parking duration
                </label>

                <div className="hours-grid">

                  {[
                    "1 hour",
                    "2 hours",
                    "3 hours",
                    "4 hours",
                    "5 hours",
                    "6 hours",
                  ].map((hour) => {

                    const hourValue =
                      hour.split(
                        " "
                      )[0];

                    return (
                      <button
                        key={
                          hour
                        }
                        type="button"
                        className={`hour-btn ${
                          duration ===
                          hourValue
                            ? "selected-hour"
                            : ""
                        }`}
                        onClick={() =>
                          setDuration(
                            hourValue
                          )
                        }
                      >
                        {hour}
                      </button>
                    );
                  })}

                </div>

                {/* =================================================
                    TOTAL PRICE
                ================================================= */}

                <div className="booking-total">

                  <span>
                    Estimated parking cost
                  </span>

                  <strong>
                    ₹
                    {Number(
                      selectedParking.price
                    ) *
                      Number(
                        duration
                      )}
                  </strong>

                </div>

                {/* =================================================
                    INFORMATION
                ================================================= */}

                <div className="reservation-details-grid">

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Available spots
                    </span>

                    <strong>
                      {selectedDateAvailability
                        ? selectedDateAvailability.availableSpots
                        : selectedParking.available}

                      {" / "}

                      {selectedParking.total}
                    </strong>

                    <small>
                      for selected date
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Parking price
                    </span>

                    <strong>
                      ₹
                      {
                        selectedParking.price
                      }
                    </strong>

                    <small>
                      per hour
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Walking distance
                    </span>

                    <strong>
                      {
                        selectedParking.walk
                      }
                    </strong>

                    <small>
                      from your location
                    </small>

                  </div>

                  <div className="reservation-detail-box">

                    <span className="details-label">
                      Parking rating
                    </span>

                    <strong>
                      ★{" "}
                      {
                        selectedParking.rating
                      }
                    </strong>

                    <small>
                      customer rating
                    </small>

                  </div>

                </div>

                {/* =================================================
                    RESERVE BUTTON
                ================================================= */}

                <button
                  className="reserve-btn"
                  onClick={
                    reserveSpot
                  }
                  disabled={
                    selectedDateAvailability &&
                    Number(
                      selectedDateAvailability.availableSpots
                    ) <= 0
                  }
                  style={{
                    opacity:
                      selectedDateAvailability &&
                      Number(
                        selectedDateAvailability.availableSpots
                      ) <= 0
                        ? 0.5
                        : 1,

                    cursor:
                      selectedDateAvailability &&
                      Number(
                        selectedDateAvailability.availableSpots
                      ) <= 0
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {selectedDateAvailability &&
                  Number(
                    selectedDateAvailability.availableSpots
                  ) <= 0
                    ? "No Spots Available"
                    : "Reserve Now"}
                </button>

              </div>

            </main>

          </div>
        )}

      {/* =====================================================
          BOOKING CONFIRMED
      ===================================================== */}

      {page ===
        "bookingConfirmed" &&
        booking && (

          <main className="parking-details-page confirmation-page">

            <div className="success-icon">
              ✓
            </div>

            <p className="card-eyebrow">
              RESERVATION CONFIRMED
            </p>

            <h1 className="details-title">
              Spot reserved!
            </h1>

            <p className="details-address">
              Your parking spot at{" "}
              {booking.name} has been
              successfully reserved.
            </p>

            <div className="confirmation-card">

              <div className="confirmation-header">

                <div className="parking-place-icon">
                  P
                </div>

                <div>

                  <h2>
                    {booking.name}
                  </h2>

                  <p>
                    {booking.address}
                  </p>

                </div>

              </div>

              <div className="confirmation-details">

                <div>

                  <span>
                    Booking ID
                  </span>

                  <strong>
                    {booking.bookingId}
                  </strong>

                </div>

                <div>

                  <span>
                    Date
                  </span>

                  <strong>
                    {booking.date}
                  </strong>

                </div>

                <div>

                  <span>
                    Arrival time
                  </span>

                  <strong>
                    {booking.arrivalTime}
                  </strong>

                </div>

                <div>

                  <span>
                    Duration
                  </span>

                  <strong>
                    {booking.duration} hour
                    {booking.duration >
                    1
                      ? "s"
                      : ""}
                  </strong>

                </div>

                <div>

                  <span>
                    Total price
                  </span>

                  <strong>
                    ₹
                    {
                      booking.totalPrice
                    }
                  </strong>

                </div>

              </div>

              <div className="confirmation-message">

                <strong>
                  Your spot is waiting for you.
                </strong>

                <p>
                  Please arrive at{" "}
                  {booking.name} around
                  your selected arrival time.
                </p>

              </div>

              <div className="confirmation-buttons">

                <button
                  className="cancel-booking-btn"
                  onClick={
                    cancelBooking
                  }
                >
                  Cancel Reservation
                </button>

                <button
                  className="primary-btn"
                  onClick={() => {
                    fetchBookings();

                    setPage(
                      "myBookings"
                    );
                  }}
                >
                  View My Booking
                </button>

                <button
                  className="secondary-btn"
                  onClick={
                    goToDashboard
                  }
                >
                  Back to Dashboard
                </button>

              </div>

            </div>

          </main>
        )}

      {/* =====================================================
          MY BOOKINGS
      ===================================================== */}

      {page ===
        "myBookings" && (

        <main className="parking-details-page">

          <p className="card-eyebrow">
            MY BOOKINGS
          </p>

          <h1 className="details-title">
            Your reservations
          </h1>

          <p className="details-address">
            Manage your active parking
            reservations.
          </p>

          {bookings.length ===
          0 ? (

            <div className="empty-state">

              <div className="empty-icon">
                P
              </div>

              <h2>
                No active bookings
              </h2>

              <p>
                You haven't reserved a
                parking spot yet.
              </p>

              <button
                className="primary-btn"
                onClick={
                  goToDashboard
                }
              >
                Find Parking
              </button>

            </div>

          ) : (

            <div className="booking-list">

              {bookings.map(
                (item) => (

                  <div
                    className="booking-card"
                    key={
                      item.bookingId
                    }
                  >

                    <div>

                      <h2>
                        {item.name}
                      </h2>

                      <p>
                        {item.address}
                      </p>

                    </div>

                    <div className="booking-info">

                      <span>
                        Date
                      </span>

                      <strong>
                        {
                          item.date
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Arrival
                      </span>

                      <strong>
                        {
                          item.arrivalTime
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Duration
                      </span>

                      <strong>
                        {
                          item.duration
                        }{" "}
                        hr
                      </strong>

                    </div>

                    <div className="booking-price">

                      <span>
                        Total
                      </span>

                      <strong>
                        ₹
                        {
                          item.totalPrice
                        }
                      </strong>

                    </div>

                    <button
                      className="cancel-btn"
                      onClick={() =>
                        cancelBooking(
                          item
                        )
                      }
                    >
                      Cancel
                    </button>

                  </div>
                )
              )}

            </div>
          )}

          <button
            className="page-secondary-btn"
            onClick={
              goToDashboard
            }
          >
            ← Back to Dashboard
          </button>

        </main>
      )}

      {/* =====================================================
          PARKING HISTORY
      ===================================================== */}

      {page ===
        "history" && (

        <main className="parking-details-page">

          <p className="card-eyebrow">
            PARKING HISTORY
          </p>

          <h1 className="details-title">
            Your parking history
          </h1>

          <p className="details-address">
            View your previous parking activity.
          </p>

          {history.length ===
          0 ? (

            <div className="empty-state">

              <div className="empty-icon">
                ↺
              </div>

              <h2>
                No parking history
              </h2>

              <p>
                Your completed or cancelled
                reservations will appear
                here.
              </p>

              <button
                className="primary-btn"
                onClick={
                  goToDashboard
                }
              >
                Find Parking
              </button>

            </div>

          ) : (

            <div className="booking-list">

              {history.map(
                (
                  item,
                  index
                ) => (

                  <div
                    className="booking-card"
                    key={`${item.bookingId}-${index}`}
                  >

                    <div>

                      <h2>
                        {item.name}
                      </h2>

                      <p>
                        {item.address}
                      </p>

                    </div>

                    <div className="booking-info">

                      <span>
                        Date
                      </span>

                      <strong>
                        {
                          item.date
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Arrival
                      </span>

                      <strong>
                        {
                          item.arrivalTime
                        }
                      </strong>

                    </div>

                    <div className="booking-info">

                      <span>
                        Duration
                      </span>

                      <strong>
                        {
                          item.duration
                        }{" "}
                        hr
                      </strong>

                    </div>

                    <div className="booking-price">

                      <span>
                        Total
                      </span>

                      <strong>
                        ₹
                        {
                          item.totalPrice
                        }
                      </strong>

                    </div>

                    <span
                      className={`history-status ${
                        item.status ===
                        "Active"
                          ? "active"
                          : "cancelled"
                      }`}
                    >
                      {
                        item.status
                      }
                    </span>

                  </div>
                )
              )}

            </div>
          )}

          <button
            className="page-secondary-btn"
            onClick={
              goToDashboard
            }
          >
            ← Back to Dashboard
          </button>

        </main>
      )}

    </div>
  );
}

export default App;
