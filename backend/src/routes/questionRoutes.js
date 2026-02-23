const express = require("express");
const router = express.Router();

/* ===============================
   MIDDLEWARE
================================ */
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");

/* ===============================
   CONTROLLER
================================ */
const questionController = require("../controllers/questionController");

/* ===============================
   ROUTES
================================ */

/**
 * @route   POST /questions
 * @desc    Create a new question (ADMIN only)
 * @access  Private (Admin)
 */
router.post(
  "/",
  auth,
  role(["admin"]),
  questionController.createQuestion
);

/* ===============================
   EXPORT ROUTER
================================ */
module.exports = router;