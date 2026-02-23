const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

/* REGISTER */
exports.register = async (req, res) => {
  try {
    const { permanent_index, name, email, password } = req.body;

    if (!permanent_index || !name || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO students
       (permanent_index, name, email, password_hash)
       VALUES ($1,$2,$3,$4)`,
      [permanent_index, name, email, hashedPassword]
    );

    res.status(201).json({ message: "Student registered" });
  } catch (err) {

  // Duplicate permanent_index or email
  if (err.code === "23505") {
    return res.status(409).json({
      error: "Student already exists"
    });
  }

  console.error(err);
  res.status(500).json({
    error: "Registration failed"
  });
}
};

/* LOGIN */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM students WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const student = result.rows[0];
    const valid = await bcrypt.compare(password, student.password_hash);

    if (!valid)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: student.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
};