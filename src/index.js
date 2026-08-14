require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { uploadDir } = require("./middleware/upload");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const vehicleRoutes = require("./routes/vehicles");
const jobRoutes = require("./routes/jobs");
const chatRoutes = require("./routes/chat");
const walletRoutes = require("./routes/wallet");
const webhookRoutes = require("./routes/webhooks");
const ratingRoutes = require("./routes/ratings");
const adminRoutes = require("./routes/admin");
const adminAuthRoutes = require("./routes/admin-auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || "*" } });
app.set("io", io);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(morgan("dev"));
app.use(express.json());
app.use("/uploads", express.static(path.resolve(uploadDir)));

app.get("/health", (req, res) => res.json({ ok: true, service: "moveme-backend" }));

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/vehicles", vehicleRoutes);
app.use("/jobs", jobRoutes);
app.use("/jobs", chatRoutes);   // adds /jobs/:id/messages under the same prefix
app.use("/jobs", ratingRoutes); // adds /jobs/:id/ratings under the same prefix
app.use("/wallet", walletRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/admin", adminRoutes);
app.use("/admin-auth", adminAuthRoutes);

// 404 + error handling
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

// --- Socket.io: authenticate the connection, then let clients join a room
// per job for live chat delivery. The REST endpoints above still do all the
// actual writes; sockets are purely for pushing live updates to open clients.
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.sub;
    next();
  } catch (e) {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.on("job:join", (jobId) => socket.join(`job:${jobId}`));
  socket.on("job:leave", (jobId) => socket.leave(`job:${jobId}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`moveMe backend listening on port ${PORT}`));
