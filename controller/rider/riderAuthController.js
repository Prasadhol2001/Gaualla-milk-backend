import pool from "../../config.js";
import { compairPassword } from "../../helper/hashing.js";
import { createToken } from "../../helper/Jwttoken.js";

export const riderLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: "Phone and password are required" });
    }

    const [riders] = await pool.query(
      `SELECT * FROM riders WHERE phone = ? OR email = ? LIMIT 1`,
      [phone, phone]
    );

    if (riders.length === 0) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    const rider = riders[0];

    if (rider.status === "suspended") {
      return res.status(403).json({ success: false, message: "Your account has been suspended. Contact admin." });
    }

    if (rider.status === "inactive") {
      return res.status(403).json({ success: false, message: "Your account is inactive. Contact admin." });
    }

    const isMatch = await compairPassword(password, rider.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = createToken(rider.id);

    res.cookie("rider", token, {
      path: "/",
      httpOnly: true,
      expires: new Date(Date.now() + 7000 * 86400 * 5),
      sameSite: "none",
      secure: true,
    });

    return res.status(200).json({
      success: true,
      token,
      message: "Login successful",
      rider: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        email: rider.email,
        avatar: rider.avatar,
        status: rider.status,
        is_online: rider.is_online,
        vehicle_type: rider.vehicle_type,
        vehicle_number: rider.vehicle_number,
      },
    });
  } catch (error) {
    console.error("Rider login error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const riderLogout = async (req, res) => {
  try {
    if (req.rider) {
      const [active] = await pool.query(
        `SELECT COUNT(*) AS count FROM order_assignments WHERE rider_id = ? AND status IN ('pending','accepted','picked_up','in_transit')`,
        [req.rider.id]
      );
      if (active[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: `You have ${active[0].count} active order(s). Please deliver or complete them before logging out.`,
        });
      }
      await pool.query(`UPDATE riders SET is_online = 0 WHERE id = ?`, [req.rider.id]);
    }

    res.cookie("rider", "", {
      path: "/",
      httpOnly: true,
      expires: new Date(Date.now()),
      sameSite: "none",
      secure: true,
    });

    return res.status(200).json({ success: true, message: "Logout successful" });
  } catch (error) {
    console.error("Rider logout error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getRiderProfile = async (req, res) => {
  try {
    const { rider } = req;
    return res.json({ success: true, rider });
  } catch (error) {
    console.error("Get rider profile error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateRiderProfile = async (req, res) => {
  try {
    const { name, email, vehicle_type, vehicle_number } = req.body;
    const riderId = req.rider.id;

    const updates = [];
    const params = [];

    if (name) { updates.push("name = ?"); params.push(name); }
    if (email) { updates.push("email = ?"); params.push(email); }
    if (vehicle_type) { updates.push("vehicle_type = ?"); params.push(vehicle_type); }
    if (vehicle_number) { updates.push("vehicle_number = ?"); params.push(vehicle_number); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(riderId);
    await pool.query(
      `UPDATE riders SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );

    const [updated] = await pool.query(
      `SELECT id, name, email, phone, avatar, status, is_online, vehicle_type, vehicle_number FROM riders WHERE id = ?`,
      [riderId]
    );

    return res.json({ success: true, message: "Profile updated", rider: updated[0] });
  } catch (error) {
    console.error("Update rider profile error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateFcmToken = async (req, res) => {
  try {
    const { fcm_token } = req.body;
    if (!fcm_token) {
      return res.status(400).json({ success: false, message: "FCM token is required" });
    }

    await pool.query(`UPDATE riders SET fcm_token = ? WHERE id = ?`, [fcm_token, req.rider.id]);

    return res.json({ success: true, message: "FCM token updated" });
  } catch (error) {
    console.error("Update FCM token error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const toggleOnline = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const goingOffline = req.rider.is_online === 1;

    if (goingOffline) {
      const [active] = await pool.query(
        `SELECT COUNT(*) AS count FROM order_assignments WHERE rider_id = ? AND status IN ('pending','accepted','picked_up','in_transit')`,
        [riderId]
      );
      if (active[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: `You have ${active[0].count} active order(s). Please deliver or complete them before going offline.`,
        });
      }
    }

    const newStatus = goingOffline ? 0 : 1;
    await pool.query(`UPDATE riders SET is_online = ? WHERE id = ?`, [newStatus, riderId]);

    return res.json({
      success: true,
      is_online: !!newStatus,
      message: newStatus ? "You are now online" : "You are now offline",
    });
  } catch (error) {
    console.error("Toggle online error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
