import pool from "../../config.js";

/**
 * Get all orders for admin
 */
export const getAllOrders = async (req, res) => {
  try {
    const { status, payment_status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        o.id,
        o.site_user_id,
        o.address_id,
        o.total_amount,
        o.status,
        o.payment_status,
        o.type,
        o.alternative_dates,
        o.created_at,
        o.updated_at,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
        a.first_name,
        a.last_name,
        a.street,
        a.city,
        a.state,
        a.zip_code,
        a.country,
        a.phone AS address_phone
      FROM orders o
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE 1=1
    `;
    const params = [];

    // Apply filters
    if (status && status !== "all") {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    if (payment_status && payment_status !== "all") {
      query += ` AND o.payment_status = ?`;
      params.push(payment_status);
    }

    if (search) {
      query += ` AND (
        o.id LIKE ? OR
        u.name LIKE ? OR
        u.email LIKE ? OR
        u.phone LIKE ? OR
        a.street LIKE ? OR
        a.city LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [orders] = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM orders o
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE 1=1
    `;
    const countParams = [];

    if (status && status !== "all") {
      countQuery += ` AND o.status = ?`;
      countParams.push(status);
    }

    if (payment_status && payment_status !== "all") {
      countQuery += ` AND o.payment_status = ?`;
      countParams.push(payment_status);
    }

    if (search) {
      countQuery += ` AND (
        o.id LIKE ? OR
        u.name LIKE ? OR
        u.email LIKE ? OR
        u.phone LIKE ? OR
        a.street LIKE ? OR
        a.city LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const [items] = await pool.query(
          `SELECT 
            oi.id,
            oi.product_id,
            oi.quantity,
            oi.price,
            p.name AS product_name,
            p.images AS product_image
          FROM order_items oi
          LEFT JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ?`,
          [order.id]
        );

        // Parse alternative_dates JSON if type is 'alternative'
        let alternativeDates = null;
        if (order.type === 'alternative' && order.alternative_dates) {
          try {
            // If it's already an array, use it directly
            if (Array.isArray(order.alternative_dates)) {
              alternativeDates = order.alternative_dates;
            } else if (typeof order.alternative_dates === 'string') {
              // Try to clean up the string before parsing
              const cleanedString = order.alternative_dates.trim();
              alternativeDates = JSON.parse(cleanedString);
            }
          } catch (e) {
            console.error(`Error parsing alternative_dates for order ${order.id}:`, e.message);
            console.error('Raw value:', JSON.stringify(order.alternative_dates));
            // If parsing fails, return null (dates won't be displayed but won't crash)
            alternativeDates = null;
          }
        }

        return {
          ...order,
          alternative_dates: alternativeDates, // Only include if parsed successfully
          items: items || [],
          item_count: items.length,
        };
      })
    );

    return res.json({
      success: true,
      orders: ordersWithItems,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

/**
 * Get single order details for admin
 */
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get order with user and address details
    const [orders] = await pool.query(
      `SELECT 
        o.*,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
        a.first_name,
        a.last_name,
        a.street,
        a.city,
        a.state,
        a.zip_code,
        a.country,
        a.phone AS address_phone,
        a.latitude,
        a.longitude
      FROM orders o
      LEFT JOIN users u ON o.site_user_id = u.id
      LEFT JOIN newaddresses a ON o.address_id = a.id
      WHERE o.id = ?`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // Parse custom delivery dates
    let customDates = null;
    const rawDates = order.custom_delivery_dates || order.alternative_dates;
    if (rawDates) {
      try {
        customDates = typeof rawDates === "string" ? JSON.parse(rawDates) : rawDates;
      } catch (_) {
        customDates = null;
      }
    }

    // Format daily deliveries status tracking summary
    let dailyDeliveriesSummary = [];
    if (customDates && Array.isArray(customDates)) {
      const todayStr = new Date().toISOString().split("T")[0];
      const [assignments] = await pool.query(
        `SELECT oa.id, oa.status, oa.assigned_at, oa.delivered_at, oa.rider_id, r.name AS rider_name, r.phone AS rider_phone
         FROM order_assignments oa
         LEFT JOIN riders r ON oa.rider_id = r.id
         WHERE oa.order_id = ?
         ORDER BY oa.assigned_at ASC`,
        [order.id]
      );

      dailyDeliveriesSummary = customDates.map(dateStr => {
        const dayAssignments = assignments.filter(a => {
          const aDate = new Date(a.assigned_at).toISOString().split("T")[0];
          return aDate === dateStr;
        });

        let match = null;
        if (dayAssignments.length > 0) {
          const delivered = dayAssignments.find(a => a.status === "delivered");
          const active = dayAssignments.find(a => ["accepted", "picked_up", "in_transit"].includes(a.status));
          const pending = dayAssignments.find(a => a.status === "pending");
          match = delivered || active || pending || dayAssignments[dayAssignments.length - 1];
        }

        let status = "pending";
        let assignmentDetails = null;

        if (match) {
          assignmentDetails = {
            assignment_id: match.id,
            rider_id: match.rider_id,
            rider_name: match.rider_name,
            rider_phone: match.rider_phone,
            delivered_at: match.delivered_at,
          };

          if (match.status === "delivered") {
            status = "delivered";
          } else if (match.status === "failed") {
            status = "failed";
          } else if (["pending", "accepted", "picked_up", "in_transit"].includes(match.status)) {
            status = "out_for_delivery";
          } else if (match.status === "rejected") {
            status = "pending";
          }
        } else {
          if (dateStr < todayStr) {
            status = "failed";
          } else if (dateStr === todayStr) {
            if (order.status === "on_hold_insufficient_funds") {
              status = "on_hold";
            } else {
              status = "pending";
            }
          } else {
            status = "pending";
          }
        }

        return {
          date: dateStr,
          status: status,
          assignment: assignmentDetails
        };
      });
    }

    // Get order items
    const [items] = await pool.query(
      `SELECT 
        oi.id,
        oi.product_id,
        oi.quantity,
        oi.price,
        oi.start_date,
        oi.last_delivery_date,
        p.name AS product_name,
        p.images AS product_image,
        p.slug AS product_slug
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
      ORDER BY oi.id`,
      [id]
    );

    // Get transaction details if exists
    const [transactions] = await pool.query(
      `SELECT * FROM transactions WHERE order_id = ? ORDER BY created_at DESC`,
      [id]
    );

    // Get refunds if any
    const [refunds] = await pool.query(
      `SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC`,
      [id]
    );

    return res.json({
      success: true,
      order: {
        ...order,
        custom_delivery_dates: customDates,
        daily_deliveries_summary: dailyDeliveriesSummary,
        address: {
          first_name: order.first_name,
          last_name: order.last_name,
          street: order.street,
          city: order.city,
          state: order.state,
          zip_code: order.zip_code,
          country: order.country,
          phone: order.address_phone,
          latitude: order.latitude,
          longitude: order.longitude,
        },
        user: {
          name: order.user_name,
          email: order.user_email,
          phone: order.user_phone,
        },
        items: items || [],
        alternative_dates: order.type === 'alternative' ? customDates : null,
        transactions: transactions || [],
        refunds: refunds || [],
      },
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order",
    });
  }
};

/**
 * Update order status
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ["pending", "processing", "out_for_delivery", "completed", "cancelled", "refunded"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Check if order exists
    const [orders] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update order status
    await pool.query(
      `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );

    return res.json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
    });
  }
};

/**
 * Update payment status
 */
export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status } = req.body;

    // Validate payment status
    const validStatuses = ["pending", "paid", "failed", "refunded"];
    if (!validStatuses.includes(payment_status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Check if order exists
    const [orders] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [id]);
    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update payment status
    await pool.query(
      `UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payment_status, id]
    );

    // If payment is marked as paid, also update order status to processing
    if (payment_status === "paid" && orders[0].status === "pending") {
      await pool.query(
        `UPDATE orders SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );
    }

    return res.json({
      success: true,
      message: "Payment status updated successfully",
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update payment status",
    });
  }
};
