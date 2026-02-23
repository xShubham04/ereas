const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 NORMALIZE USER OBJECT
    req.user = {
      id: decoded.studentId || decoded.id,
      role: decoded.role
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};