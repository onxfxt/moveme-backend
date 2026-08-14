const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.kind === "admin") return res.status(401).json({ error: "Admin tokens cannot be used on customer/driver routes" });
    req.userId = payload.sub;
    req.userRole = payload.role;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Verifies a DEDICATED admin-terminal token (see routes/admin-auth.js). This
// is intentionally a completely separate login system from the customer/
// driver phone-OTP flow — admin/staff accounts are created by the business
// owner from the admin terminal itself, not via app sign-up.
function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing admin auth token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.kind !== "admin") return res.status(401).json({ error: "Not an admin token" });
    req.adminId = payload.sub;
    req.adminRole = payload.role;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired admin session — please log in again" });
  }
}

module.exports = { signToken, requireAuth, requireAdminAuth };
