const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const examController = require("../controllers/examController");

// Admin
router.post("/", auth, role(["admin"]), examController.createExam);
router.post(
  "/:examId/questions",
  auth,
  role(["admin"]),
  examController.assignQuestions
);

// Student (require student role)
router.post("/:examId/start", auth, role(["student"]), examController.startExam);
router.post("/answer", auth, role(["student"]), examController.saveAnswer);
router.post("/submit", auth, role(["student"]), examController.submitExam);
// review can be called as /:examId/review or /review?examId=... (easier for clients)
router.get("/:examId/review", auth, role(["student"]), examController.reviewExam);
router.get("/review", auth, role(["student"]), examController.reviewExam);
// Analytics
router.get("/analytics/student/:examId", auth, examController.studentAnalytics);
router.get("/analytics/student/:examId/subjects", auth, examController.subjectBreakdown);
router.get("/analytics/admin/exam/:examId", auth, role(["admin"]), examController.adminExamAnalytics);
router.get("/analytics/exam/:examId/leaderboard", auth, examController.examLeaderboard);

module.exports = router;