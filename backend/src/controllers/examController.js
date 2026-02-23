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

    res.status(201).json({
      exam_id: result.rows[0].id
    });

  } catch (err) {
    console.error("Create exam error:", err);
    res.status(500).json({ error: "Failed to create exam" });
  }
};

/* ============================================================
   ASSIGN RANDOM QUESTIONS TO EXAM (ADMIN)
============================================================ */
exports.assignQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const { blueprint } = req.body;

    if (!Array.isArray(blueprint) || blueprint.length === 0) {
      return res.status(400).json({ error: "Invalid blueprint" });
    }

    // Prevent reassignment
    const exists = await pool.query(
      "SELECT 1 FROM exam_questions WHERE exam_id = $1 LIMIT 1",
      [examId]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({
        error: "Questions already assigned to this exam"
      });
    }

    let order = 1;

    for (const block of blueprint) {
      const { subject, difficulty, count } = block;

      if (!subject || !count) {
        return res.status(400).json({
          error: "Blueprint block must include subject and count"
        });
      }

      let sql = `
        SELECT id
        FROM questions
        WHERE subject = $1
      `;
      const params = [subject];

      if (difficulty !== undefined) {
        sql += ` AND difficulty = $2`;
        params.push(difficulty);
      }

      sql += ` ORDER BY RANDOM() LIMIT $${params.length + 1}`;
      params.push(count);

      const questions = await pool.query(sql, params);

      if (questions.rows.length < count) {
        return res.status(400).json({
          error: `Not enough questions for subject: ${subject}`
        });
      }

      for (const q of questions.rows) {
        await pool.query(
          `
          INSERT INTO exam_questions
          (exam_id, question_id, question_order)
          VALUES ($1, $2, $3)
          `,
          [examId, q.id, order]
        );
        order++;
      }
    }

    res.status(201).json({
      message: "Questions assigned successfully",
      total_questions: order - 1
    });

  } catch (err) {
    console.error("Assign questions error:", err);
    res.status(500).json({
      error: "Failed to assign questions"
    });
  }
};

/* ============================================================
   START EXAM (STUDENT)
============================================================ */
exports.startExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const studentId = req.user.id;

    // Ensure exam exists
    const examRes = await pool.query(
      "SELECT duration_minutes FROM exams WHERE id = $1",
      [examId]
    );

    if (examRes.rows.length === 0) {
      return res.status(404).json({ error: "Exam not found" });
    }

    // Ensure questions are assigned
    const qCheck = await pool.query(
      "SELECT 1 FROM exam_questions WHERE exam_id = $1 LIMIT 1",
      [examId]
    );

    if (qCheck.rows.length === 0) {
      return res.status(400).json({
        error: "Exam questions not assigned yet"
      });
    }

    // Check if session already exists
    const existingSession = await pool.query(
      "SELECT * FROM exam_sessions WHERE exam_id = $1 AND student_id = $2",
      [examId, studentId]
    );

    if (existingSession.rows.length > 0) {
      return res.status(200).json({
        session_id: existingSession.rows[0].id,
        message: "Exam already started"
      });
    }

    // Create session
    const duration = examRes.rows[0].duration_minutes;

    const sessionRes = await pool.query(
      `
      INSERT INTO exam_sessions
      (exam_id, student_id, started_at, expires_at, status)
       VALUES
     ($1, $2, NOW(), NOW() + INTERVAL '${duration} minutes', 'active')
      RETURNING id, expires_at
      `,
      [examId, studentId]
    );

    const sessionId = sessionRes.rows[0].id;

    // Fetch questions (NO answers)
    const questionsRes = await pool.query(
      `
      SELECT
        q.id,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.option_e,
        eq.question_order
      FROM exam_questions eq
      JOIN questions q ON q.id = eq.question_id
      WHERE eq.exam_id = $1
      ORDER BY eq.question_order
      `,
      [examId]
    );

    res.status(201).json({
      session_id: sessionId,
      expires_at: sessionRes.rows[0].expires_at,
      questions: questionsRes.rows
    });

  } catch (err) {
    console.error("Start exam error:", err);
    res.status(500).json({
      error: "Failed to start exam"
    });
  }
};
/* ============================================================
   AUTOSAVE ANSWER
============================================================ */
exports.saveAnswer = async (req, res) => {
  try {
    const { sessionId, questionId, selected_option } = req.body;
    const studentId = req.user.id;

    if (!sessionId || !questionId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Validate session belongs to student & active
    const sessionRes = await pool.query(
      `
      SELECT * FROM exam_sessions
      WHERE id = $1 AND student_id = $2 AND status = 'active'
      `,
      [sessionId, studentId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: "Invalid session" });
    }

    // Upsert answer
    await pool.query(
      `
      INSERT INTO answers (session_id, question_id, selected_option)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET
        selected_option = EXCLUDED.selected_option,
        saved_at = CURRENT_TIMESTAMP
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
   SUBMIT EXAM (STUDENT)
============================================================ */
exports.submitExam = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const studentId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID required" });
    }

    // Validate active session
    const sessionRes = await pool.query(
      `
      SELECT * FROM exam_sessions
      WHERE id = $1 AND student_id = $2 AND status = 'active'
      `,
      [sessionId, studentId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: "Invalid or closed session" });
    }

    // Evaluate answers
    const evalRes = await pool.query(
      `
      SELECT
        a.question_id,
        a.selected_option,
        q.correct_option
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      WHERE a.session_id = $1
      `,
      [sessionId]
    );

    let score = 0;

    for (const row of evalRes.rows) {
      const isCorrect = row.selected_option === row.correct_option;
      if (isCorrect) score++;

      await pool.query(
        `
        UPDATE answers
        SET is_correct = $1
        WHERE session_id = $2 AND question_id = $3
        `,
        [isCorrect, sessionId, row.question_id]
      );
    }

    // Total questions
    const totalRes = await pool.query(
      `
      SELECT COUNT(*) FROM exam_questions eq
      JOIN exam_sessions es ON es.exam_id = eq.exam_id
      WHERE es.id = $1
      `,
      [sessionId]
    );

    const totalQuestions = Number(totalRes.rows[0].count);

    // Close session
    await pool.query(
      `
      UPDATE exam_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE id = $1
      `,
      [sessionId]
    );

    res.json({
      message: "Exam submitted successfully",
      score,
      total_questions: totalQuestions,
      percentage: ((score / totalQuestions) * 100).toFixed(2)
    });

  } catch (err) {
    console.error("Submit exam error:", err);
    res.status(500).json({ error: "Failed to submit exam" });
  }
};