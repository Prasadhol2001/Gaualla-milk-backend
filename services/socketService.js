import { Server } from "socket.io";
import { TokenVerify } from "../helper/Jwttoken.js";
import pool from "../config.js";

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, 
    {
    cors: {
      origin: (origin, callback) => callback(null, true),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Rider namespace - riders connect here to send location and receive assignments
  const riderNsp = io.of("/rider");
  riderNsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));
      const riderId = TokenVerify(token);
      if (!riderId) return next(new Error("Invalid token"));
      const [rows] = await pool.query(`SELECT id, name, status FROM riders WHERE id = ?`, [riderId]);
      if (rows.length === 0) return next(new Error("Rider not found"));
      if (rows[0].status === "suspended") return next(new Error("Account suspended"));
      socket.riderId = riderId;
      socket.riderName = rows[0].name;
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  riderNsp.on("connection", (socket) => {
    console.log(`Rider connected: ${socket.riderName} (${socket.riderId})`);
    socket.join(`rider_${socket.riderId}`);

    socket.on("location:update", async (data) => {
      try {
        const { latitude, longitude, speed, heading } = data;
        if (latitude == null || longitude == null) return;

        await pool.query(
          `UPDATE riders SET current_latitude = ?, current_longitude = ?, last_location_update = CURRENT_TIMESTAMP WHERE id = ?`,
          [latitude, longitude, socket.riderId]
        );

        await pool.query(
          `INSERT INTO rider_location_history (rider_id, latitude, longitude, speed, heading) VALUES (?, ?, ?, ?, ?)`,
          [socket.riderId, latitude, longitude, speed || null, heading || null]
        );

        // Broadcast to admin namespace for live map
        const adminNsp = io.of("/admin");
        adminNsp.emit("rider:location", {
          rider_id: socket.riderId,
          rider_name: socket.riderName,
          latitude,
          longitude,
          speed,
          heading,
          timestamp: new Date().toISOString(),
        });

        // Broadcast to any customers tracking orders from this rider
        const [activeAssignments] = await pool.query(
          `SELECT order_id FROM order_assignments WHERE rider_id = ? AND status IN ('accepted','picked_up','in_transit')`,
          [socket.riderId]
        );

        const trackingNsp = io.of("/tracking");
        for (const assignment of activeAssignments) {
          trackingNsp.to(`order_${assignment.order_id}`).emit("rider:location", {
            rider_id: socket.riderId,
            latitude,
            longitude,
            speed,
            heading,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Location update error:", err);
      }
    });

    socket.on("disconnect", async () => {
      console.log(`Rider disconnected: ${socket.riderName} (${socket.riderId})`);
    });
  });

  // Tracking namespace - customers connect here to track their orders
  const trackingNsp = io.of("/tracking");
  trackingNsp.on("connection", (socket) => {
    socket.on("track:order", (data) => {
      const { order_id } = data;
      if (order_id) {
        socket.join(`order_${order_id}`);
        console.log(`Customer tracking order: ${order_id}`);
      }
    });

    socket.on("untrack:order", (data) => {
      const { order_id } = data;
      if (order_id) {
        socket.leave(`order_${order_id}`);
      }
    });

    socket.on("disconnect", () => {});
  });

  // Admin namespace - admins see live rider locations and new order events
  const adminNsp = io.of("/admin");
  adminNsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));
      const adminId = TokenVerify(token);
      if (!adminId) return next(new Error("Invalid token"));
      const [rows] = await pool.query(`SELECT id FROM admins WHERE id = ?`, [adminId]);
      if (rows.length === 0) return next(new Error("Admin not found"));
      socket.adminId = adminId;
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  adminNsp.on("connection", (socket) => {
    console.log(`Admin connected to socket: ${socket.adminId}`);
    socket.on("disconnect", () => {
      console.log(`Admin disconnected: ${socket.adminId}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
}

export function emitToRider(riderId, event, data) {
  if (!io) return;
  io.of("/rider").to(`rider_${riderId}`).emit(event, data);
}

export function emitToAdmins(event, data) {
  if (!io) return;
  io.of("/admin").emit(event, data);
}

export function emitOrderUpdate(orderId, event, data) {
  if (!io) return;
  io.of("/tracking").to(`order_${orderId}`).emit(event, data);
}
