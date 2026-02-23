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

/* ============================================================
   LIST QUESTIONS (ADMIN)
   - Supports filtering & pagination
============================================================ */
exports.listQuestions = async (req, res) => {
  try {
    const { subject, difficulty, page = 1, limit = 10 } = req.query;

    const offset = (page - 1) * limit;
    const conditions = [];
    const values = [];

    if (subject) {
      values.push(subject);
      conditions.push(`subject = $${values.length}`);
    }

    if (difficulty) {
      values.push(difficulty);
      conditions.push(`difficulty = $${values.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT
        id,
        question_text,
        subject,
        difficulty,
        created_at
      FROM questions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    values.push(limit);
    values.push(offset);

    const result = await pool.query(query, values);

    res.json({
      page: Number(page),
      limit: Number(limit),
      count: result.rows.length,
      questions: result.rows
    });

  } catch (err) {
    console.error("List questions error:", err);
    res.status(500).json({
      error: "Failed to fetch questions"
    });
  }
};

const { parse } = require("csv-parse/sync");
const XLSX = require("xlsx");

/* ============================================================
   BULK QUESTION UPLOAD (ADMIN)
============================================================ */
exports.bulkUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    let records = [];

    /* --------------------
       PARSE FILE
    -------------------- */
    if (req.file.mimetype === "text/csv") {
      records = parse(req.file.buffer.toString(), {
        columns: true,
        skip_empty_lines: true
      });
    } else {
      const workbook = XLSX.read(req.file.buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(sheet);
    }

    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    /* --------------------
       PROCESS ROWS
    -------------------- */
    for (const row of records) {
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
          difficulty
        } = row;

        if (
          !question_text ||
          !option_a ||
          !option_b ||
          !correct_option ||
          !subject ||
          !difficulty
        ) {
          errors++;
          continue;
        }

        // Duplicate check
        const dup = await pool.query(
          `
          SELECT 1 FROM questions
          WHERE similarity(question_text, $1) >= 0.85
          LIMIT 1
          `,
          [question_text]
        );

        if (dup.rows.length > 0) {
          duplicates++;
          continue;
        }

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
            created_by
          )
          VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
            req.user.id
          ]
        );

        inserted++;

      } catch {
        errors++;
      }
    }

    res.json({
      total_rows: records.length,
      inserted,
      duplicates,
      errors
    });

  } catch (err) {
    console.error("Bulk upload error:", err);
    res.status(500).json({
      error: "Bulk upload failed"
    });
  }
};