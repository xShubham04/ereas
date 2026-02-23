// LOAD ENV FIRST (must be first line)
require("dotenv").config();

const express = require("express");
const cors = require("cors");

// IMPORT SERVICES
const pool = require("./config/db");
const redis = require("./config/redis");
const kafkaProducer = require("./config/kafka");

const app = express();

app.use(cors());
app.use(express.json());

/* ===============================
   CONNECT KAFKA ON SERVER START
================================*/
(async () => {
  try {
    await kafkaProducer.connect();
    console.log("✅ Kafka connected");
  } catch (err) {
    console.log("⚠️ Kafka connection failed (ok for now)");
  }
})();

/* ===============================
   HEALTH CHECK ROUTE
================================*/
app.get("/", async (req, res) => {

  try {

    // TEST POSTGRES
    const dbTime = await pool.query("SELECT NOW()");

    // TEST REDIS
    await redis.set("health", "OK");
    const redisVal = await redis.get("health");

    res.json({
      status: "EREAS BACKEND RUNNING",
      postgres_time: dbTime.rows[0].now,
      redis: redisVal
    });

  } catch (err) {

    console.error("Health route error:", err);

    res.status(500).json({
      error: "Server health check failed"
    });

  }

});

/* ===============================
   SERVER START
================================*/
const PORT = process.env.PORT || 5055;

app.listen(PORT, () => {
  console.log(`🚀 EREAS backend running on port ${PORT}`);
});