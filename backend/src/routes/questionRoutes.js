const express = require("express");
const router = express.Router();

/* ===============================
   MIDDLEWARE
================================ */
const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const upload = require("../middleware/uploadMiddleware");

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

/**
 * @route   GET /questions
 * @desc    List questions with filters (ADMIN only)
 * @access  Private (Admin)
 */
router.get(
  "/",
  auth,
  role(["admin"]),
  questionController.listQuestions
);

/**
 * @route   POST /questions/bulk
 * @desc    Bulk upload questions (CSV / XLSX)
 * @access  Private (Admin)
 */
router.post(
  "/bulk",
  auth,
  role(["admin"]),
  upload.single("file"),
  questionController.bulkUpload
);
/* ===============================
   EXPORT ROUTER
================================ */
module.exports = router;
