import pool from "../../config.js";

/**
 * GET /admin/splash
 * Returns all splash messages (admin panel)
 */
const getAllMessages = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM splash_messages ORDER BY created_at DESC`
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getAllMessages error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * POST /admin/splash
 * Create a new splash message
 */
const createMessage = async (req, res) => {
  try {
    const { title, message, emoji, type, start_date, end_date, is_active } = req.body;

    if (!title || !message || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "title, message, start_date, and end_date are required",
      });
    }

    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({
        success: false,
        message: "end_date must be on or after start_date",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO splash_messages (title, message, emoji, type, start_date, end_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        message,
        emoji || "🌟",
        type || "greeting",
        start_date,
        end_date,
        is_active !== undefined ? is_active : 1,
      ]
    );

    const [newRow] = await pool.query(
      `SELECT * FROM splash_messages WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ success: true, data: newRow[0] });
  } catch (error) {
    console.error("createMessage error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * PUT /admin/splash/:id
 * Update an existing splash message
 */
const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, emoji, type, start_date, end_date, is_active } = req.body;

    // Check exists
    const [existing] = await pool.query(
      `SELECT id FROM splash_messages WHERE id = ?`,
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({
        success: false,
        message: "end_date must be on or after start_date",
      });
    }

    await pool.execute(
      `UPDATE splash_messages
       SET title = COALESCE(?, title),
           message = COALESCE(?, message),
           emoji = COALESCE(?, emoji),
           type = COALESCE(?, type),
           start_date = COALESCE(?, start_date),
           end_date = COALESCE(?, end_date),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [title, message, emoji, type, start_date, end_date, is_active, id]
    );

    const [updated] = await pool.query(
      `SELECT * FROM splash_messages WHERE id = ?`,
      [id]
    );

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("updateMessage error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * DELETE /admin/splash/:id
 * Delete a splash message
 */
const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `DELETE FROM splash_messages WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    return res.json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    console.error("deleteMessage error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * PATCH /admin/splash/:id/toggle
 * Toggle is_active status
 */
const toggleActive = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.query(
      `SELECT id, is_active FROM splash_messages WHERE id = ?`,
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    const newStatus = existing[0].is_active ? 0 : 1;

    await pool.execute(
      `UPDATE splash_messages SET is_active = ? WHERE id = ?`,
      [newStatus, id]
    );

    return res.json({ success: true, is_active: newStatus });
  } catch (error) {
    console.error("toggleActive error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * GET /api/user/splash-message
 * Public endpoint — returns the active message for today.
 * Events take priority over greetings.
 */
const getActiveMessageForToday = async (req, res) => {
  try {
    // Use UTC date to keep it consistent
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    const [rows] = await pool.query(
      `SELECT title, message, emoji, type
       FROM splash_messages
       WHERE is_active = 1
         AND start_date <= ?
         AND end_date >= ?
       ORDER BY 
         CASE type WHEN 'event' THEN 0 ELSE 1 END ASC,
         created_at DESC
       LIMIT 1`,
      [today, today]
    );

    if (rows.length === 0) {
      return res.json({ success: false });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("getActiveMessageForToday error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const splashMessageController = {
  getAllMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  toggleActive,
  getActiveMessageForToday,
};
