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

    res.status(201).json({ message: "Questions assigned successfully" });
  } catch (err) {
    console.error("Assign questions error:", err);
    res.status(500).json({ error: "Failed to assign questions" });
  }
};

/* ============================================================
   START EXAM (STUDENT)
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

    // Auto-finalize expired attempts
    await pool.query(
      `
      UPDATE exam_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE student_id = $1
        AND status = 'active'
        AND expires_at <= NOW()
      `,
      [studentId]
    );

    const active = await pool.query(
      `
      SELECT *
      FROM exam_sessions
      WHERE exam_id = $1 AND student_id = $2 AND status = 'active'
      LIMIT 1
      `,
      [examId, studentId]
    );

    if (active.rows.length) {
      return res.json({
        session_id: active.rows[0].id,
        expires_at: active.rows[0].expires_at
      });
    }

    const session = await pool.query(
      `
      INSERT INTO exam_sessions
      (exam_id, student_id, started_at, expires_at, status)
      VALUES (
        $1,
        $2,
        NOW(),
        NOW() + ($3 || ' minutes')::interval,
        'active'
      )
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
    const { sessionId, questionId, selected_option } = req.body;

    const valid = await pool.query(
      `
      SELECT 1
      FROM exam_sessions
      WHERE id = $1 AND student_id = $2
        AND status = 'active'
        AND expires_at > NOW()
      `,
      [sessionId, req.user.id]
    );

    if (!valid.rows.length) {
      return res.status(403).json({ error: "Session expired or invalid" });
    }

    await pool.query(
      `
      INSERT INTO answers (session_id, question_id, selected_option)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET
        selected_option = EXCLUDED.selected_option,
        saved_at = NOW()
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
   SUBMIT EXAM
============================================================ */
exports.submitExam = async (req, res) => {
  try {
    const { sessionId } = req.body;

    await pool.query(
      `
      UPDATE exam_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1 AND student_id = $2
      `,
      [sessionId, req.user.id]
    );

    res.json({ message: "Exam submitted successfully" });
  } catch (err) {
    console.error("Submit exam error:", err);
    res.status(500).json({ error: "Failed to submit exam" });
  }
};

/* ============================================================
   REVIEW EXAM (BULLETPROOF)
============================================================ */
exports.reviewExam = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Finalize ALL expired exams
    await pool.query(
      `
      UPDATE exam_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE student_id = $1
        AND status = 'active'
        AND expires_at <= NOW()
      `,
      [studentId]
    );

    const session = await pool.query(
      `
      SELECT *
      FROM exam_sessions
      WHERE student_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
      `,
      [studentId]
    );

    if (!session.rows.length) {
      return res.status(403).json({ error: "Exam not completed yet" });
    }

    const result = await pool.query(
      `
      SELECT
        q.question_text,
        q.correct_option,
        a.selected_option,
        a.is_correct,
        eq.question_order
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      LEFT JOIN answers a
        ON a.question_id = q.id
       AND a.session_id = $1
      WHERE eq.exam_id = $2
      ORDER BY eq.question_order
      `,
      [session.rows[0].id, session.rows[0].exam_id]
    );

    res.json({
      exam_id: session.rows[0].exam_id,
      completed_at: session.rows[0].completed_at,
      questions: result.rows
    });
  } catch (err) {
    console.error("Review exam error:", err);
    res.status(500).json({ error: "Failed to review exam" });
  }
};