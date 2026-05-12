import pool from "../../config.js";

let newsletterTableReady;

async function ensureNewsletterTable() {
  if (!newsletterTableReady) {
    newsletterTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_newsletter_email (email),
        UNIQUE KEY unique_newsletter_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  return newsletterTableReady;
}

export const subscribeNewsletter = async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";

    if (!email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Email and phone number are required",
      });
    }

    await ensureNewsletterTable();

    const [existingRows] = await pool.query(
      "SELECT id, email, phone FROM newsletter_subscribers WHERE email = ? OR phone = ? LIMIT 1",
      [email, phone]
    );

    if (existingRows.length > 0) {
      return res.status(200).json({
        success: true,
        message: "You are already subscribed",
        data: existingRows[0],
      });
    }

    const [result] = await pool.query(
      "INSERT INTO newsletter_subscribers (email, phone) VALUES (?, ?)",
      [email, phone]
    );

    return res.status(201).json({
      success: true,
      message: "Newsletter subscription saved successfully",
      data: {
        id: result.insertId,
        email,
        phone,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(200).json({
        success: true,
        message: "You are already subscribed",
      });
    }

    console.error("Error saving newsletter subscription:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while saving newsletter subscription",
    });
  }
};

export const getNewsletterSubscribers = async (req, res) => {
  try {
    await ensureNewsletterTable();

    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const [subscribers] = await pool.query(
      `SELECT id, email, phone, created_at, updated_at
       FROM newsletter_subscribers
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM newsletter_subscribers`
    );

    return res.json({
      success: true,
      message: "Newsletter subscribers fetched successfully",
      data: subscribers,
      pagination: {
        total: countRows[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error fetching newsletter subscribers:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching newsletter subscribers",
    });
  }
};