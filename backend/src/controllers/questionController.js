const pool = require("../config/db");

/* ============================================================
   CREATE QUESTION (ADMIN ONLY)
   - Validates input
   - Detects duplicates using pg_trgm similarity
============================================================ */
exports.createQuestion = async (req, res) => {
  try {
    const {
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      option_e,
      correct_option,
      subject,
      difficulty,
      image_path
    } = req.body;

    /* --------------------
       BASIC VALIDATION
    -------------------- */
    if (
      !question_text ||
      !option_a ||
      !option_b ||
      !correct_option ||
      !subject ||
      !difficulty
    ) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    /* --------------------
       DUPLICATE CHECK (≥85%)
    -------------------- */
    const duplicateCheck = await pool.query(
      `
      SELECT
        question_text,
        similarity(question_text, $1) AS similarity_score
      FROM questions
      WHERE similarity(question_text, $1) >= 0.85
      ORDER BY similarity_score DESC
      LIMIT 1
      `,
      [question_text]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        error: "Duplicate question detected",
        similar_question: duplicateCheck.rows[0].question_text,
        similarity_score: duplicateCheck.rows[0].similarity_score
      });
    }

    /* --------------------
       INSERT QUESTION
    -------------------- */
    await pool.query(
      `
      INSERT INTO questions
      (
        question_text,
        option_a,
        option_b,
        option_c,
        option_d,
        option_e,
        correct_option,
        subject,
        difficulty,
        image_path,
        created_by
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        question_text,
        option_a,
        option_b,
        option_c || null,
        option_d || null,
        option_e || null,
        correct_option,
        subject,
        difficulty,
        image_path || null,
        req.user.id
      ]
    );

    res.status(201).json({
      message: "Question created successfully"
    });

  } catch (err) {
    console.error("Create question error:", err);
    res.status(500).json({
      error: "Failed to create question"
    });
  }
};