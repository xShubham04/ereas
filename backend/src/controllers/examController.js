const pool = require("../config/db");

/* ============================================================
   CREATE EXAM (ADMIN)
============================================================ */
exports.createExam = async (req, res) => {
  try {
    const { title, duration_minutes } = req.body;

    if (!title || !duration_minutes) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO exams (title, duration_minutes, created_by)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [title, duration_minutes, req.user.id]
    );

    res.status(201).json({ exam_id: result.rows[0].id });
  } catch (err) {
    console.error("Create exam error:", err);
    res.status(500).json({ error: "Failed to create exam" });
  }
};

/* ============================================================
   ASSIGN QUESTIONS (ADMIN)
============================================================ */
exports.assignQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const { blueprint } = req.body;

    if (!Array.isArray(blueprint) || blueprint.length === 0) {
      return res.status(400).json({ error: "Invalid blueprint" });
    }

    const exists = await pool.query(
      "SELECT 1 FROM exam_questions WHERE exam_id = $1 LIMIT 1",
      [examId]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "Questions already assigned" });
    }

    let order = 1;

    for (const block of blueprint) {
      const { subject, difficulty, count } = block;

      let sql = `SELECT id FROM questions WHERE subject = $1`;
      const params = [subject];

      if (difficulty !== undefined) {
        sql += ` AND difficulty = $2`;
        params.push(difficulty);
      }

      sql += ` ORDER BY RANDOM() LIMIT $${params.length + 1}`;
      params.push(count);

      const qs = await pool.query(sql, params);

      if (qs.rows.length < count) {
        return res.status(400).json({
          error: `Not enough questions for ${subject}`
        });
      }

      for (const q of qs.rows) {
        await pool.query(
          `
          INSERT INTO exam_questions (exam_id, question_id, question_order)
          VALUES ($1, $2, $3)
          `,
          [examId, q.id, order++]
        );
      }
    }

    res.status(201).json({
      message: "Questions assigned successfully",
      total_questions: order - 1
    });
  } catch (err) {
    console.error("Assign questions error:", err);
    res.status(500).json({ error: "Failed to assign questions" });
  }
};

/* ============================================================
   START EXAM
============================================================ */
exports.startExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const studentId = req.user.id;

    const exam = await pool.query(
      "SELECT duration_minutes FROM exams WHERE id = $1",
      [examId]
    );

    if (!exam.rows.length) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const existing = await pool.query(
      `
      SELECT *
      FROM exam_sessions
      WHERE exam_id = $1 AND student_id = $2
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [examId, studentId]
    );

    if (existing.rows.length && existing.rows[0].status === "active") {
      return res.json({
        session_id: existing.rows[0].id,
        expires_at: existing.rows[0].expires_at,
        message: "Exam already started"
      });
    }

    const session = await pool.query(
      `
      INSERT INTO exam_sessions
      (exam_id, student_id, started_at, expires_at, status)
      VALUES ($1, $2, NOW(), NOW() + ($3 || ' minutes')::interval, 'active')
      RETURNING id, expires_at
      `,
      [examId, studentId, exam.rows[0].duration_minutes]
    );

    const questions = await pool.query(
      `
      SELECT q.id, q.question_text,
             q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
             eq.question_order
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      WHERE eq.exam_id = $1
      ORDER BY eq.question_order
      `,
      [examId]
    );

    res.status(201).json({
      session_id: session.rows[0].id,
      expires_at: session.rows[0].expires_at,
      questions: questions.rows
    });
  } catch (err) {
    console.error("Start exam error:", err);
    res.status(500).json({ error: "Failed to start exam" });
  }
};

/* ============================================================
   SAVE ANSWER
============================================================ */
exports.saveAnswer = async (req, res) => {
  try {
    let { sessionId, questionId, selected_option } = req.body;

    if (typeof sessionId === 'string') {
      sessionId = sessionId.trim().replace(/\/+$/, "");
    }

    const session = await pool.query(
      `
      SELECT * FROM exam_sessions
      WHERE id = $1
      `,
      [sessionId]
    );

    if (!session.rows.length) {
      console.warn("saveAnswer: session not found", sessionId);
      return res.status(403).json({ error: "Invalid session id" });
    }

    if (session.rows[0].student_id !== req.user.id) {
      console.warn(
        "saveAnswer: session user mismatch",
        sessionId,
        "db student_id=", session.rows[0].student_id,
        "token user=", req.user.id
      );
      return res.status(403).json({
        error: "Session does not belong to authenticated user"
      });
    }

    if (session.rows[0].status !== 'active') {
      console.warn("saveAnswer: session not active", sessionId, session.rows[0].status);
      return res.status(403).json({ error: "Session not active" });
    }

    await pool.query(
      `
      INSERT INTO answers (session_id, question_id, selected_option)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET selected_option = EXCLUDED.selected_option
      `,
      [sessionId, questionId, selected_option]
    );

    res.json({ message: "Answer saved" });
  } catch (err) {
    console.error("Save answer error:", err);
    res.status(500).json({ error: "Failed to save answer" });
  }
};

/* ============================================================
   SUBMIT EXAM (FINAL)
============================================================ */
exports.submitExam = async (req, res) => {
  try {
    let { sessionId } = req.body;

    // sanitise possible trailing slash or whitespace from client-side copy/paste
    if (typeof sessionId === 'string') {
      sessionId = sessionId.trim().replace(/\/+$/, "");
    }

    const sessionRes = await pool.query(
      `
      SELECT * FROM exam_sessions
      WHERE id = $1
      `,
      [sessionId]
    );

    if (!sessionRes.rows.length) {
      console.warn("submitExam: session not found", sessionId);
      return res.status(403).json({ error: "Invalid session id" });
    }

    const sessionRow = sessionRes.rows[0];

    if (sessionRow.student_id !== req.user.id) {
      console.warn(
        "submitExam: session user mismatch",
        sessionId,
        "db student_id=", sessionRow.student_id,
        "token user=", req.user.id
      );
      return res.status(403).json({
        error: "Session does not belong to authenticated user"
      });
    }

    if (sessionRow.status !== 'active') {
      console.warn("submitExam: session not active", sessionId, sessionRow.status);
      return res.status(403).json({ error: "Session not active" });
    }

    const evalRes = await pool.query(
      `
      SELECT a.selected_option, q.correct_option
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      WHERE a.session_id = $1
      `,
      [sessionId]
    );

    let score = 0;
    for (const row of evalRes.rows) {
      if (row.selected_option === row.correct_option) score++;
    }

    const total = evalRes.rows.length;
    const percentage = ((score / total) * 100).toFixed(2);

    // note: results table uses total_questions column and requires exam_id, student_id
    await pool.query(
      `
      INSERT INTO results (
        session_id, exam_id, student_id,
        score, total_questions, percentage,
        started_at, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      [
        sessionId,
        sessionRow.exam_id,
        sessionRow.student_id,
        score,
        total,
        percentage,
        sessionRow.started_at
      ]
    );

    await pool.query(
      `
      UPDATE exam_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1
      `,
      [sessionId]
    );

    res.json({
      message: "Exam submitted",
      score,
      total,
      percentage
    });
  } catch (err) {
    console.error("Submit exam error:", err);
    res.status(500).json({ error: "Failed to submit exam" });
  }
};

/* ============================================================
   REVIEW EXAM
============================================================ */
exports.reviewExam = async (req, res) => {
  try {
    // support both route param and query param for convenience
    let examId = req.params.examId || req.query.examId;

    if (!examId) {
      return res.status(400).json({ error: "Missing examId" });
    }

    const result = await pool.query(
      `
      SELECT r.*, s.completed_at
      FROM results r
      JOIN exam_sessions s ON s.id = r.session_id
      WHERE s.exam_id = $1 AND s.student_id = $2
      ORDER BY r.created_at DESC
      LIMIT 1
      `,
      [examId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(403).json({ error: "Exam not completed yet" });
    }

    const sessionId = result.rows[0].session_id;

    const questions = await pool.query(
      `
      SELECT q.question_text, q.correct_option,
             a.selected_option, a.is_correct, eq.question_order
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      LEFT JOIN answers a
        ON a.question_id = q.id AND a.session_id = $1
      WHERE eq.exam_id = $2
      ORDER BY eq.question_order
      `,
      [sessionId, examId]
    );

    res.json({
      score: result.rows[0].score,
      total: result.rows[0].total,
      percentage: result.rows[0].percentage,
      questions: questions.rows
    });
  } catch (err) {
    console.error("Review exam error:", err);
    res.status(500).json({ error: "Failed to review exam" });
  }
};
/* ============================================================
   STUDENT PERFORMANCE SUMMARY
============================================================ */
exports.studentAnalytics = async (req, res) => {
  try {
    const { examId } = req.params;

    const result = await pool.query(
      `
      SELECT r.score, r.total, r.percentage, r.created_at
      FROM results r
      JOIN exam_sessions s ON s.id = r.session_id
      WHERE s.exam_id = $1 AND s.student_id = $2
      ORDER BY r.created_at DESC
      LIMIT 1
      `,
      [examId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "No results found" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Student analytics error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
};
/* ============================================================
   SUBJECT BREAKDOWN
============================================================ */
exports.subjectBreakdown = async (req, res) => {
  try {
    const { examId } = req.params;

    const breakdown = await pool.query(
      `
      SELECT
        q.subject,
        COUNT(*) FILTER (WHERE a.is_correct = true) AS correct,
        COUNT(*) AS total
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      JOIN exam_sessions s ON s.exam_id = eq.exam_id
      LEFT JOIN answers a
        ON a.question_id = q.id
       AND a.session_id = s.id
      WHERE s.exam_id = $1
        AND s.student_id = $2
      GROUP BY q.subject
      `,
      [examId, req.user.id]
    );

    res.json(breakdown.rows);

  } catch (err) {
    console.error("Subject breakdown error:", err);
    res.status(500).json({ error: "Failed to fetch breakdown" });
  }
};
/* ============================================================
   ADMIN EXAM ANALYTICS
============================================================ */
exports.adminExamAnalytics = async (req, res) => {
  try {
    const { examId } = req.params;

    const stats = await pool.query(
      `
      SELECT
        COUNT(*) AS total_attempts,
        AVG(score) AS avg_score,
        MAX(score) AS highest_score,
        MIN(score) AS lowest_score
      FROM results r
      JOIN exam_sessions s ON s.id = r.session_id
      WHERE s.exam_id = $1
      `,
      [examId]
    );

    res.json(stats.rows[0]);

  } catch (err) {
    console.error("Admin analytics error:", err);
    res.status(500).json({ error: "Failed to fetch exam analytics" });
  }
};
/* ============================================================
   EXAM LEADERBOARD
============================================================ */
exports.examLeaderboard = async (req, res) => {
  try {
    const { examId } = req.params;

    const leaderboard = await pool.query(
      `
      SELECT
        s.student_id,
        r.score,
        r.percentage,
        RANK() OVER (ORDER BY r.score DESC) AS rank
      FROM results r
      JOIN exam_sessions s ON s.id = r.session_id
      WHERE s.exam_id = $1
      ORDER BY r.score DESC
      `,
      [examId]
    );

    res.json(leaderboard.rows);

  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
};