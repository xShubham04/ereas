const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const examController = require("../controllers/examController");

/**
 * @route   POST /exams
 * @desc    Create exam
 * @access  Admin
 */
router.post(
  "/",
  auth,
  role(["admin"]),
  examController.createExam
);

/**
 * @route   POST /exams/:examId/questions
 * @desc    Assign randomized questions to exam
 * @access  Admin
 */
router.post(
  "/:examId/questions",
  auth,
  role(["admin"]),
  examController.assignQuestions
);

/**
 * @route   POST /exams/:examId/start
 * @desc    Start exam (Student)
 * @access  Student
 */
router.post(
  "/:examId/start",
  auth,
  role(["student"]),
  examController.startExam
);

/**
 * @route   POST /exams/answer
 * @desc    Autosave answer
 * @access  Student
 */
router.post(
  "/answer",
  auth,
  role(["student"]),
  examController.saveAnswer
);
/**
 * @route   POST /exams/submit
 * @desc    Submit exam & evaluate
 * @access  Student
 */
router.post(
  "/submit",
  auth,
  role(["student"]),
  examController.submitExam
);
module.exports = router;

