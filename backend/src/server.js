// LOAD ENV FIRST (must be first line)
require("dotenv").config();

const express = require("express");
const cors = require("cors");

/* ===============================
   IMPORT ROUTES
================================ */
const authRoutes = require("./routes/authRoutes");
const questionRoutes = require("./routes/questionRoutes");

/* ===============================
   IMPORT MIDDLEWARE
================================ */
const auth = require("./middleware/authMiddleware");
const role = require("./middleware/roleMiddleware");

/* ===============================
   IMPORT SERVICES
================================ */
const pool = require("./config/db");
const redis = require("./config/redis");
const kafkaProducer = require("./config/kafka");

const app = express();

/* ===============================
   GLOBAL MIDDLEWARE
================================ */
app.use(cors());
app.use(express.json());

/* ===============================
   ROUTES
================================ */
app.use("/auth", authRoutes);
app.use("/questions", questionRoutes);

/* ===============================
   CONNECT KAFKA ON STARTUP
================================ */
(async () => {
  try {
    await kafkaProducer.connect();
    console.log("✅ Kafka connected");
  } catch (err) {
    console.log("⚠️ Kafka connection failed (ok for now)");
  }
})();

/* ===============================
   HEALTH CHECK
================================ */
app.get("/", async (req, res) => {
  try {
    const dbTime = await pool.query("SELECT NOW()");
    await redis.set("health", "OK");

    res.json({
      status: "EREAS BACKEND RUNNING",
      postgres_time: dbTime.rows[0].now,
      redis: await redis.get("health")
    });
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).json({
      error: "Server health check failed"
    });
  }
});

/* ===============================
   ROLE TEST ROUTES (TEMP)
================================ */
app.get("/admin/test",
  auth,
  role(["admin"]),
  (req, res) => {
    res.json({ message: "Admin access granted" });
  }
);

app.get("/student/test",
  auth,
  role(["student"]),
  (req, res) => {
    res.json({ message: "Student access granted" });
  }
);

/* ===============================
   SERVER START
================================ */
const PORT = process.env.PORT || 5055;

app.listen(PORT, () => {
  console.log(`🚀 EREAS backend running on port ${PORT}`);
});