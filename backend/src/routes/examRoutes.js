const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const role = require("../middleware/roleMiddleware");
const examController = require("../controllers/examController");

// ADMIN
router.post("/", auth, role(["admin"]), examController.createExam);
router.post("/:examId/questions", auth, role(["admin"]), examController.assignQuestions);

// STUDENT
router.post("/:examId/start", auth, role(["student"]), examController.startExam);
router.post("/answer", auth, role(["student"]), examController.saveAnswer);
router.post("/submit", auth, role(["student"]), examController.submitExam);

// NOTE: review does NOT need examId anymore
router.get("/review", auth, role(["student"]), examController.reviewExam);

module.exports = router;