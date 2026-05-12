import pool from "../../config.js";

const ALLOWED_STATUS = ["active", "inactive", "scheduled", "expired"];

function normalizeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function validateOfferPayload(payload) {
  const offerTitle = typeof payload.offer_title === "string" ? payload.offer_title.trim() : "";
  const offerPercent = Number(payload.offer_percent);
  const startTime = normalizeDateTime(payload.start_time);
  const endTime = normalizeDateTime(payload.end_time);
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "inactive";

  if (!offerTitle) {
    return { error: "Offer title is required" };
  }

  if (!Number.isFinite(offerPercent) || offerPercent <= 0 || offerPercent > 100) {
    return { error: "Offer percent must be a number between 0 and 100" };
  }

  if (!startTime || !endTime) {
    return { error: "start_time and end_time are required and must be valid dates" };
  }

  if (startTime >= endTime) {
    return { error: "end_time must be greater than start_time" };
  }

  if (!ALLOWED_STATUS.includes(status)) {
    return { error: `Status must be one of: ${ALLOWED_STATUS.join(", ")}` };
  }

  return {
    data: {
      offerTitle,
      offerPercent,
      startTime,
      endTime,
      status,
    },
  };
}

async function ensureOfferTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      offer_title VARCHAR(255) NOT NULL,
      offer_percent DECIMAL(5,2) NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      status ENUM('active','inactive','scheduled','expired') NOT NULL DEFAULT 'inactive',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_time (start_time, end_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export const createOffer = async (req, res) => {
  try {
    await ensureOfferTable();

    const validation = validateOfferPayload(req.body);
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const { offerTitle, offerPercent, startTime, endTime, status } = validation.data;

    const [result] = await pool.query(
      `INSERT INTO offers (offer_title, offer_percent, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?)`,
      [offerTitle, offerPercent, startTime, endTime, status]
    );

    return res.status(201).json({
      success: true,
      message: "Offer created successfully",
      data: {
        id: result.insertId,
        offer_title: offerTitle,
        offer_percent: offerPercent,
        start_time: startTime,
        end_time: endTime,
        status,
      },
    });
  } catch (error) {
    console.error("Error creating offer:", error);
    return res.status(500).json({ success: false, message: "Server error while creating offer" });
  }
};

export const getAllOffers = async (req, res) => {
  try {
    await ensureOfferTable();

    const { status, limit = 20, offset = 0 } = req.query;
    const params = [];
    let where = "WHERE 1=1";

    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    const [offers] = await pool.query(
      `SELECT * FROM offers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM offers ${where}`,
      params
    );

    return res.json({
      success: true,
      data: offers,
      pagination: {
        total: countRows[0]?.total || 0,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  } catch (error) {
    console.error("Error fetching offers:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching offers" });
  }
};

export const getOfferById = async (req, res) => {
  try {
    await ensureOfferTable();

    const { id } = req.params;
    const [rows] = await pool.query(`SELECT * FROM offers WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Error fetching offer:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching offer" });
  }
};

export const updateOffer = async (req, res) => {
  try {
    await ensureOfferTable();

    const { id } = req.params;
    const validation = validateOfferPayload(req.body);
    if (validation.error) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const [existing] = await pool.query(`SELECT id FROM offers WHERE id = ?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    const { offerTitle, offerPercent, startTime, endTime, status } = validation.data;
    await pool.query(
      `UPDATE offers
       SET offer_title = ?, offer_percent = ?, start_time = ?, end_time = ?, status = ?
       WHERE id = ?`,
      [offerTitle, offerPercent, startTime, endTime, status, id]
    );

    return res.json({ success: true, message: "Offer updated successfully" });
  } catch (error) {
    console.error("Error updating offer:", error);
    return res.status(500).json({ success: false, message: "Server error while updating offer" });
  }
};

export const updateOfferStatus = async (req, res) => {
  try {
    await ensureOfferTable();

    const { id } = req.params;
    const { status } = req.body;
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";

    if (!ALLOWED_STATUS.includes(normalized)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${ALLOWED_STATUS.join(", ")}`,
      });
    }

    const [existing] = await pool.query(`SELECT id FROM offers WHERE id = ?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    await pool.query(`UPDATE offers SET status = ? WHERE id = ?`, [normalized, id]);

    return res.json({ success: true, message: "Offer status updated successfully" });
  } catch (error) {
    console.error("Error updating offer status:", error);
    return res.status(500).json({ success: false, message: "Server error while updating offer status" });
  }
};

export const deleteOffer = async (req, res) => {
  try {
    await ensureOfferTable();

    const { id } = req.params;
    const [existing] = await pool.query(`SELECT id FROM offers WHERE id = ?`, [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    await pool.query(`DELETE FROM offers WHERE id = ?`, [id]);

    return res.json({ success: true, message: "Offer deleted successfully" });
  } catch (error) {
    console.error("Error deleting offer:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting offer" });
  }
};