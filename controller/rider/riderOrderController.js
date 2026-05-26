import pool from "../../config.js";
import { emitToAdmins, emitOrderUpdate } from "../../services/socketService.js";
import { createNotification, notifyUser } from "../../services/firebaseService.js";
import { restockOrderItems } from "../../services/stockService.js";

export const getAssignedOrders = async (req, res) => {
  try {
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT 
        oa.id AS assignment_id, oa.status AS assignment_status, oa.assigned_at, oa.cod_amount,
        oa.distance_km, oa.estimated_time_minutes,
        o.id AS order_id, o.total_amount, o.status AS order_status, o.payment_status,
        o.type, o.delivery_otp, o.created_at AS order_date,
        u.name AS customer_name, u.phone AS customer_phone,
        a.first_name, a.last_name, a.street, a.landmark, a.city, a.state, a.zip_code,
        a.phone AS address_phone, a.latitude, a.longitude
      FROM order_assignments oa
      JOIN orders o ON oa.order_id = o.id
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE oa.rider_id = ? AND oa.status IN ('pending', 'accepted', 'picked_up', 'in_transit')
      ORDER BY oa.assigned_at DESC`,
      [riderId]
    );

    return res.json({ success: true, orders: assignments });
  } catch (error) {
    console.error("Get assigned orders error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

export const getActiveOrder = async (req, res) => {
  try {
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT 
        oa.*, o.id AS order_id, o.total_amount, o.status AS order_status, o.payment_status,
        o.type, o.delivery_otp, o.notes,
        u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
        a.first_name, a.last_name, a.street, a.landmark, a.city, a.state, a.zip_code,
        a.country, a.phone AS address_phone, a.latitude, a.longitude
      FROM order_assignments oa
      JOIN orders o ON oa.order_id = o.id
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE oa.rider_id = ? AND oa.status IN ('accepted', 'picked_up', 'in_transit')
      ORDER BY oa.accepted_at DESC LIMIT 1`,
      [riderId]
    );

    if (assignments.length === 0) {
      return res.json({ success: true, order: null });
    }

    const assignment = assignments[0];

    const [items] = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.images AS product_image
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [assignment.order_id]
    );

    return res.json({ success: true, order: { ...assignment, items } });
  } catch (error) {
    console.error("Get active order error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch active order" });
  }
};

export const getOrderHistory = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let statusFilter = "AND oa.status IN ('delivered', 'failed', 'rejected')";
    let countStatusFilter = "AND status IN ('delivered', 'failed', 'rejected')";

    if (status === 'completed' || status === 'delivered') {
      statusFilter = "AND oa.status = 'delivered'";
      countStatusFilter = "AND status = 'delivered'";
    } else if (status === 'cancelled' || status === 'failed') {
      statusFilter = "AND oa.status IN ('failed', 'rejected')";
      countStatusFilter = "AND status IN ('failed', 'rejected')";
    }

    const [assignments] = await pool.query(
      `SELECT 
        oa.id AS assignment_id, oa.status AS assignment_status, oa.assigned_at, oa.delivered_at,
        oa.cod_amount, oa.cod_collected, oa.distance_km,
        o.id AS order_id, o.total_amount, o.payment_status, o.type,
        u.name AS customer_name,
        a.street, a.city
      FROM order_assignments oa
      JOIN orders o ON oa.order_id = o.id
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE oa.rider_id = ? ${statusFilter}
      ORDER BY oa.delivered_at DESC, oa.assigned_at DESC
      LIMIT ? OFFSET ?`,
      [riderId, parseInt(limit), offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM order_assignments WHERE rider_id = ? ${countStatusFilter}`,
      [riderId]
    );

    return res.json({
      success: true,
      orders: assignments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get order history error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch order history" });
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT 
        oa.*, o.id AS order_id, o.total_amount, o.status AS order_status, o.payment_status,
        o.type, o.delivery_otp, o.notes, o.created_at AS order_date,
        u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
        a.first_name, a.last_name, a.street, a.landmark, a.city, a.state, a.zip_code,
        a.country, a.phone AS address_phone, a.latitude, a.longitude
      FROM order_assignments oa
      JOIN orders o ON oa.order_id = o.id
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Order assignment not found" });
    }

    const assignment = assignments[0];

    const [items] = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.images AS product_image
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [assignment.order_id]
    );

    return res.json({ success: true, order: { ...assignment, items } });
  } catch (error) {
    console.error("Get order detail error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
};

export const acceptOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT oa.*, o.site_user_id FROM order_assignments oa JOIN orders o ON oa.order_id = o.id WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (assignments[0].status !== "pending") {
      return res.status(400).json({ success: false, message: `Cannot accept order in '${assignments[0].status}' status` });
    }

    await pool.query(
      `UPDATE order_assignments SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await pool.query(
      `UPDATE orders SET delivery_status = 'accepted' WHERE id = ?`,
      [assignments[0].order_id]
    );

    emitToAdmins("order:status_changed", {
      order_id: assignments[0].order_id,
      assignment_id: id,
      status: "accepted",
      rider_id: riderId,
    });

    emitOrderUpdate(assignments[0].order_id, "order:status_changed", {
      delivery_status: "accepted",
      rider_name: req.rider.name,
    });

    notifyUser(assignments[0].site_user_id,
      "Rider Accepted Your Order",
      `${req.rider.name} has accepted your order and will pick it up soon.`,
      "order_accepted",
      { order_id: String(assignments[0].order_id) }
    ).catch(() => {});

    return res.json({ success: true, message: "Order accepted" });
  } catch (error) {
    console.error("Accept order error:", error);
    return res.status(500).json({ success: false, message: "Failed to accept order" });
  }
};

export const rejectOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT * FROM order_assignments WHERE id = ? AND rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (assignments[0].status !== "pending") {
      return res.status(400).json({ success: false, message: "Can only reject pending assignments" });
    }

    await pool.query(
      `UPDATE order_assignments SET status = 'rejected', rejection_reason = ? WHERE id = ?`,
      [reason || null, id]
    );

    await pool.query(
      `UPDATE orders SET delivery_status = 'unassigned', assigned_rider_id = NULL WHERE id = ?`,
      [assignments[0].order_id]
    );

    emitToAdmins("order:rejected", {
      order_id: assignments[0].order_id,
      assignment_id: id,
      rider_id: riderId,
      rider_name: req.rider.name,
      reason,
    });

    return res.json({ success: true, message: "Order rejected" });
  } catch (error) {
    console.error("Reject order error:", error);
    return res.status(500).json({ success: false, message: "Failed to reject order" });
  }
};

export const pickupOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT oa.*, o.site_user_id FROM order_assignments oa JOIN orders o ON oa.order_id = o.id WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (assignments[0].status !== "accepted") {
      return res.status(400).json({ success: false, message: "Order must be accepted before pickup" });
    }

    await pool.query(
      `UPDATE order_assignments SET status = 'picked_up', picked_up_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    await pool.query(
      `UPDATE orders SET delivery_status = 'picked_up' WHERE id = ?`,
      [assignments[0].order_id]
    );

    emitToAdmins("order:status_changed", {
      order_id: assignments[0].order_id,
      status: "picked_up",
      rider_id: riderId,
    });

    emitOrderUpdate(assignments[0].order_id, "order:status_changed", {
      delivery_status: "picked_up",
    });

    notifyUser(assignments[0].site_user_id,
      "Order Picked Up",
      "Your order has been picked up and is being prepared for delivery.",
      "order_accepted",
      { order_id: String(assignments[0].order_id) }
    ).catch(() => {});

    return res.json({ success: true, message: "Order picked up" });
  } catch (error) {
    console.error("Pickup order error:", error);
    return res.status(500).json({ success: false, message: "Failed to update order" });
  }
};

export const startDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT oa.*, o.site_user_id FROM order_assignments oa JOIN orders o ON oa.order_id = o.id WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (assignments[0].status !== "picked_up") {
      return res.status(400).json({ success: false, message: "Order must be picked up before starting delivery" });
    }

    await pool.query(
      `UPDATE order_assignments SET status = 'in_transit' WHERE id = ?`,
      [id]
    );

    await pool.query(
      `UPDATE orders SET delivery_status = 'in_transit' WHERE id = ?`,
      [assignments[0].order_id]
    );

    emitToAdmins("order:status_changed", {
      order_id: assignments[0].order_id,
      status: "in_transit",
      rider_id: riderId,
    });

    emitOrderUpdate(assignments[0].order_id, "order:status_changed", {
      delivery_status: "in_transit",
      rider_name: req.rider.name,
    });

    notifyUser(assignments[0].site_user_id,
      "Your Order is On the Way!",
      `${req.rider.name} is on the way to deliver your order.`,
      "order_assigned",
      { order_id: String(assignments[0].order_id) }
    ).catch(() => {});

    return res.json({ success: true, message: "Delivery started" });
  } catch (error) {
    console.error("Start delivery error:", error);
    return res.status(500).json({ success: false, message: "Failed to start delivery" });
  }
};

export const deliverOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp, delivery_proof } = req.body;
    const riderId = req.rider.id;

    const [assignments] = await pool.query(
      `SELECT oa.*, o.delivery_otp, o.site_user_id, o.payment_status
       FROM order_assignments oa
       JOIN orders o ON oa.order_id = o.id
       WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (!["picked_up", "in_transit"].includes(assignments[0].status)) {
      return res.status(400).json({ success: false, message: "Order is not ready for delivery" });
    }

    // Verify OTP if set
    if (assignments[0].delivery_otp && otp !== assignments[0].delivery_otp) {
      return res.status(400).json({ success: false, message: "Invalid delivery OTP" });
    }

    await pool.query(
      `UPDATE order_assignments SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP, delivery_proof = ? WHERE id = ?`,
      [delivery_proof || null, id]
    );

    // If order type is a subscription (daily, alternative, weekly, monthly, custom_dates), keep order status as 'processing'
    const [orderRows] = await pool.query(`SELECT type FROM orders WHERE id = ?`, [assignments[0].order_id]);
    const orderType = orderRows.length > 0 ? orderRows[0].type : "onetime";
    const isSubscription = ["daily", "alternative", "weekly", "monthly", "custom_dates"].includes(orderType);

    if (isSubscription) {
      await pool.query(
        `UPDATE orders SET delivery_status = 'delivered', status = 'processing' WHERE id = ?`,
        [assignments[0].order_id]
      );
    } else {
      await pool.query(
        `UPDATE orders SET delivery_status = 'delivered', status = 'completed' WHERE id = ?`,
        [assignments[0].order_id]
      );
    }

    // Create earnings record
    await pool.query(
      `INSERT INTO rider_earnings (rider_id, order_assignment_id, delivery_fee, cod_amount, cod_settled)
       VALUES (?, ?, ?, ?, 0)`,
      [riderId, id, 0, assignments[0].cod_amount || 0]
    );

    emitToAdmins("order:delivered", {
      order_id: assignments[0].order_id,
      assignment_id: id,
      rider_id: riderId,
    });

    emitOrderUpdate(assignments[0].order_id, "order:status_changed", {
      delivery_status: "delivered",
    });

    notifyUser(assignments[0].site_user_id,
      "Order Delivered!",
      "Your order has been delivered successfully.",
      "order_delivered",
      { order_id: String(assignments[0].order_id) }
    ).catch(() => {});

    return res.json({ success: true, message: "Order delivered successfully" });
  } catch (error) {
    console.error("Deliver order error:", error);
    return res.status(500).json({ success: false, message: "Failed to deliver order" });
  }
};

export const collectCOD = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    const riderId = req.rider.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid amount is required" });
    }

    const [assignments] = await pool.query(
      `SELECT * FROM order_assignments WHERE id = ? AND rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    await pool.query(
      `UPDATE order_assignments SET cod_amount = ?, cod_collected = 1 WHERE id = ?`,
      [amount, id]
    );

    await pool.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = ?`,
      [assignments[0].order_id]
    );

    await pool.query(
      `UPDATE rider_earnings SET cod_amount = ? WHERE order_assignment_id = ?`,
      [amount, id]
    );

    emitToAdmins("payment:cod_collected", {
      order_id: assignments[0].order_id,
      rider_id: riderId,
      amount,
    });

    await createNotification("admin", 1,
      "COD Payment Collected",
      `Rider ${req.rider.name} collected ₹${amount} for order #${assignments[0].order_id}`,
      "payment_collected",
      { order_id: assignments[0].order_id, rider_id: riderId, amount }
    );

    return res.json({ success: true, message: "COD payment collected" });
  } catch (error) {
    console.error("Collect COD error:", error);
    return res.status(500).json({ success: false, message: "Failed to collect payment" });
  }
};

export const getDashboardStats = async (req, res) => {
  try {
    const riderId = req.rider.id;
    const today = new Date().toISOString().split("T")[0];

    const [todayStats] = await pool.query(
      `SELECT 
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered_today,
        COUNT(CASE WHEN status IN ('pending','accepted','picked_up','in_transit') THEN 1 END) AS active_count,
        SUM(CASE WHEN status = 'delivered' AND cod_collected = 1 THEN cod_amount ELSE 0 END) AS cod_collected_today
      FROM order_assignments
      WHERE rider_id = ? AND DATE(assigned_at) = ?`,
      [riderId, today]
    );

    const [totalStats] = await pool.query(
      `SELECT 
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS total_delivered,
        SUM(CASE WHEN cod_collected = 1 THEN cod_amount ELSE 0 END) AS total_cod_collected,
        SUM(CASE WHEN cod_collected = 1 AND cod_settled = 0 THEN cod_amount ELSE 0 END) AS unsettled_cod
      FROM order_assignments WHERE rider_id = ?`,
      [riderId]
    );

    return res.json({
      success: true,
      stats: {
        today: todayStats[0],
        total: totalStats[0],
        is_online: req.rider.is_online,
      },
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};
export const markFailed = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const riderId = req.rider.id;

    if (!reason) {
      return res.status(400).json({ success: false, message: "Reason for failure is required" });
    }

    const [assignments] = await pool.query(
      `SELECT oa.*, o.site_user_id, o.payment_status, o.total_amount, o.payment_method, o.type AS order_type
       FROM order_assignments oa
       JOIN orders o ON oa.order_id = o.id
       WHERE oa.id = ? AND oa.rider_id = ?`,
      [id, riderId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    if (!["accepted", "picked_up", "in_transit"].includes(assignments[0].status)) {
      return res.status(400).json({ success: false, message: "Order cannot be marked as failed from current status" });
    }

    const isSubscription = ["daily", "alternative", "weekly", "monthly", "custom_dates"].includes(assignments[0].order_type);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Update status
    await connection.query(
      `UPDATE order_assignments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    if (isSubscription) {
      await connection.query(
        `UPDATE orders SET delivery_status = 'failed', status = 'processing' WHERE id = ?`,
        [assignments[0].order_id]
      );
    } else {
      await connection.query(
        `UPDATE orders SET delivery_status = 'failed', status = 'cancelled' WHERE id = ?`,
        [assignments[0].order_id]
      );
    }

    // Restock the items since the order is cancelled/failed today
    await restockOrderItems(assignments[0].order_id, connection);

    // 2. Automated Refund if paid via wallet or online (razorpay)
    const isPaid = assignments[0].payment_status === 'paid';
    const isRefundablePayment = ['wallet', 'razorpay'].includes(assignments[0].payment_method);

    if (isRefundablePayment && isPaid) {
      const site_user_id = assignments[0].site_user_id;
      
      // Calculate correct refund amount
      let refundAmount = parseFloat(assignments[0].total_amount);
      if (isSubscription) {
        const [items] = await connection.query(
          `SELECT price, quantity FROM order_items WHERE order_id = ?`,
          [assignments[0].order_id]
        );
        let dailyAmount = 0.00;
        for (const item of items) {
          dailyAmount += parseFloat(item.price) * parseInt(item.quantity);
        }
        refundAmount = dailyAmount;
      }

      // Check if already refunded for this specific delivery assignment/day to prevent duplicate refunds
      const referenceId = isSubscription ? `refund_sub_asn_${id}` : String(assignments[0].order_id);
      
      const [existingRefund] = await connection.query(
        `SELECT id FROM wallet_transactions WHERE reference_id = ? AND source = 'refund'`,
        [referenceId]
      );

      if (existingRefund.length === 0) {
        // Select or create wallet
        const [wallets] = await connection.query(
          `SELECT id, main_balance FROM wallets WHERE user_id = ? FOR UPDATE`,
          [site_user_id]
        );

        if (wallets.length > 0) {
          const walletId = wallets[0].id;
          const oldMain = parseFloat(wallets[0].main_balance);
          const newMain = oldMain + refundAmount;

          // Credit back to main balance
          await connection.query(
            `UPDATE wallets SET main_balance = ? WHERE id = ?`,
            [newMain, walletId]
          );

          // Log refund transaction
          await connection.query(
            `INSERT INTO wallet_transactions (wallet_id, type, source, amount, main_amount, cashback_amount, reference_id, title, description, status)
             VALUES (?, 'credit', 'refund', ?, ?, 0.00, ?, 'Refund for Failed Delivery', ?, 'success')`,
            [
              walletId,
              refundAmount,
              refundAmount,
              referenceId,
              `Refund for order #${assignments[0].order_id} (Delivery failed: ${reason})`
            ]
          );

          // Update order payment status only for one-time orders. 
          // For subscriptions, keep it 'paid' so future schedules continue to run.
          if (!isSubscription) {
            await connection.query(
              `UPDATE orders SET payment_status = 'refunded' WHERE id = ?`,
              [assignments[0].order_id]
            );
          }
        }
      }
    }

    await connection.commit();
    connection.release();
    connection = null;

    emitToAdmins("order:failed", {
      order_id: assignments[0].order_id,
      assignment_id: id,
      rider_id: riderId,
      reason,
    });

    emitOrderUpdate(assignments[0].order_id, "order:status_changed", {
      delivery_status: "failed",
    });

    const hasRefund = isRefundablePayment && isPaid;
    notifyUser(assignments[0].site_user_id,
      "Delivery Failed",
      `We couldn't deliver your order. ${hasRefund ? 'Refund initiated to your wallet.' : 'Our team will contact you soon.'}`,
      "order_failed",
      { order_id: String(assignments[0].order_id) }
    ).catch(() => {});

    return res.json({ success: true, message: "Order marked as failed and refund processed if applicable" });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Mark failed error:", error);
    return res.status(500).json({ success: false, message: "Failed to update status" });
  }
};
