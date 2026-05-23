import {
  createPaymentLink,
  getPaymentLinkById,
  syncPaymentLinkStatus,
  cancelPaymentLink,
} from "../../services/paymentLinkService.js";
import pool from "../../config.js";
import { decrementStock } from "../../services/stockService.js";

/**
 * Create a UPI-first payment link for an order
 */
export const createOrderPaymentLink = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      order_id,
      address_id,
      cart_items,
      total_amount,
      type,
      description,
      customer_name,
      customer_email,
      customer_contact,
      expire_by_hours = 24, // Default 24 hours expiry
      notes,
    } = req.body;

    // Validate required fields
    if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart items are required",
      });
    }

    if (!total_amount || total_amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid total amount is required",
      });
    }

    // Calculate discount if any
    let subtotal = 0;
    cart_items.forEach((item) => {
      subtotal += parseFloat(item.price || 0) * parseInt(item.quantity || 1);
    });
    const discount = subtotal - parseFloat(total_amount);
    const finalAmount = parseFloat(total_amount);

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create order first (if order_id not provided)
      let orderId = order_id;
      if (!orderId) {
        const [orderResult] = await connection.query(
          `INSERT INTO orders (
            site_user_id, address_id, total_amount, status, payment_status, type, notes
          ) VALUES (?, ?, ?, 'pending', 'pending', ?, ?)`,
          [userId, address_id || null, finalAmount, type || "onetime", notes || null]
        );
        orderId = orderResult.insertId;
      }

      // Create order items
      for (const item of cart_items) {
        await connection.query(
          `INSERT INTO order_items (
            order_id, product_id, quantity, price, discount, variant_name, start_date
          ) VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
          [
            orderId,
            item.product_id,
            item.quantity,
            item.price,
            discount / cart_items.length, // Distribute discount equally
            item.variant_name || null,
          ]
        );
      }

      // Decrement product stock
      await decrementStock(cart_items, connection);

      // Create payment link
      const expireBy = expire_by_hours * 3600; // Convert hours to seconds
      const paymentLink = await createPaymentLink({
        amount: finalAmount,
        currency: "INR",
        description: description || `Payment for Order #${orderId}`,
        customer: {
          name: customer_name || req.user.name,
          email: customer_email || req.user.email,
          contact: customer_contact || req.user.phone,
        },
        orderId,
        userId,
        expireBy,
        notes: notes || `Order ID: ${orderId}`,
        metadata: {
          order_id: orderId.toString(),
          user_id: userId.toString(),
        },
      });

      // Update payment link ID in order (if needed for reference)
      await connection.query(
        `UPDATE orders SET notes = CONCAT(COALESCE(notes, ''), ' Payment Link: ', ?) WHERE id = ?`,
        [paymentLink.razorpay_payment_link_id, orderId]
      );

      await connection.commit();

      return res.json({
        success: true,
        message: "Payment link created successfully",
        data: {
          payment_link: paymentLink,
          order_id: orderId,
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Error creating payment link:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create payment link",
    });
  }
};

/**
 * Get payment link details
 */
export const getPaymentLink = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const paymentLink = await getPaymentLinkById(id);

    if (!paymentLink) {
      return res.status(404).json({
        success: false,
        message: "Payment link not found",
      });
    }

    // Verify ownership
    if (parseInt(paymentLink.site_user_id) !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    // Sync status from Razorpay
    const syncedLink = await syncPaymentLinkStatus(
      paymentLink.razorpay_payment_link_id
    );

    // Get associated transactions
    const [transactions] = await pool.query(
      `SELECT * FROM transactions 
       WHERE payment_link_id = ? 
       ORDER BY created_at DESC`,
      [paymentLink.id]
    );

    return res.json({
      success: true,
      data: {
        payment_link: {
          ...paymentLink,
          razorpay_status: syncedLink.status,
        },
        transactions,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching payment link:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment link",
    });
  }
};

/**
 * Get all payment links for the user
 */
export const getUserPaymentLinks = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `SELECT * FROM payment_links WHERE site_user_id = ?`;
    const params = [userId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [paymentLinks] = await pool.query(query, params);

    // Get count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM payment_links WHERE site_user_id = ?${status ? ` AND status = ?` : ""}`,
      status ? [userId, status] : [userId]
    );

    return res.json({
      success: true,
      data: {
        payment_links: paymentLinks,
        pagination: {
          total: countResult[0].total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching payment links:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment links",
    });
  }
};

/**
 * Check payment status (polling fallback)
 */
export const checkPaymentStatus = async (req, res) => {
  try {
    const { payment_link_id } = req.params;
    const userId = req.user.id;

    const paymentLink = await getPaymentLinkById(payment_link_id);

    if (!paymentLink) {
      return res.status(404).json({
        success: false,
        message: "Payment link not found",
      });
    }

    // Verify ownership
    if (parseInt(paymentLink.site_user_id) !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    // Sync status from Razorpay
    const syncedLink = await syncPaymentLinkStatus(
      paymentLink.razorpay_payment_link_id
    );

    // Get latest transaction
    const [transactions] = await pool.query(
      `SELECT * FROM transactions 
       WHERE payment_link_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [paymentLink.id]
    );

    return res.json({
      success: true,
      data: {
        status: syncedLink.status,
        payment_status: transactions[0]?.status || "pending",
        payment_link_id: paymentLink.id,
        order_id: paymentLink.order_id,
        transaction: transactions[0] || null,
      },
    });
  } catch (error) {
    console.error("❌ Error checking payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check payment status",
    });
  }
};

/**
 * Cancel payment link
 */
export const cancelUserPaymentLink = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const paymentLink = await getPaymentLinkById(id);

    if (!paymentLink) {
      return res.status(404).json({
        success: false,
        message: "Payment link not found",
      });
    }

    // Verify ownership
    if (parseInt(paymentLink.site_user_id) !== parseInt(userId)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    // Check if already paid or cancelled
    if (paymentLink.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel a paid payment link",
      });
    }

    if (paymentLink.status === "cancelled") {
      return res.json({
        success: true,
        message: "Payment link already cancelled",
      });
    }

    await cancelPaymentLink(paymentLink.razorpay_payment_link_id);

    return res.json({
      success: true,
      message: "Payment link cancelled successfully",
    });
  } catch (error) {
    console.error("❌ Error cancelling payment link:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel payment link",
    });
  }
};
