import pool from "../../config.js";
import { suggestRidersForOrder, findNearbyActiveRiders, generateDeliveryOTP, haversineDistance, estimateDeliveryTime } from "../../services/assignmentService.js";
import { emitToRider, emitToAdmins } from "../../services/socketService.js";
import { sendToRider, createNotification } from "../../services/firebaseService.js";

export const assignOrderToRider = async (req, res) => {
  try {
    const { order_id, rider_id, admin_notes } = req.body;

    if (!order_id || !rider_id) {
      return res.status(400).json({ success: false, message: "Order ID and rider ID required" });
    }

    const [orders] = await pool.query(
      `SELECT o.*, a.latitude, a.longitude FROM orders o LEFT JOIN newaddresses a ON o.address_id = a.id WHERE o.id = ?`,
      [order_id]
    );
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const [riders] = await pool.query(
      `SELECT * FROM riders WHERE id = ? AND status = 'active'`,
      [rider_id]
    );
    if (riders.length === 0) {
      return res.status(404).json({ success: false, message: "Active rider not found" });
    }

    // Determine the delivery date: use the scheduler-set current_delivery_date, or default to today
    const deliveryDate = orders[0].current_delivery_date
      ? new Date(orders[0].current_delivery_date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    // Check if delivery is already completed for this date
    const [alreadyDelivered] = await pool.query(
      `SELECT id FROM order_assignments WHERE order_id = ? AND delivery_date = ? AND status = 'delivered'`,
      [order_id, deliveryDate]
    );
    if (alreadyDelivered.length > 0) {
      return res.status(400).json({ success: false, message: "This order has already been delivered for this date" });
    }

    // Check for existing pending/active assignment
    const [existingAssignment] = await pool.query(
      `SELECT id FROM order_assignments WHERE order_id = ? AND status NOT IN ('rejected', 'failed', 'delivered')`,
      [order_id]
    );
    if (existingAssignment.length > 0) {
      return res.status(400).json({ success: false, message: "This order already has an active assignment" });
    }

    // Calculate distance if coordinates available
    let distanceKm = null;
    let estimatedMinutes = null;
    if (orders[0].latitude && orders[0].longitude && riders[0].current_latitude && riders[0].current_longitude) {
      distanceKm = haversineDistance(
        parseFloat(riders[0].current_latitude), parseFloat(riders[0].current_longitude),
        parseFloat(orders[0].latitude), parseFloat(orders[0].longitude)
      );
      distanceKm = Math.round(distanceKm * 100) / 100;
      estimatedMinutes = estimateDeliveryTime(distanceKm);
    }

    // Determine COD amount
    const isCOD = orders[0].payment_status === "pending";
    const codAmount = isCOD ? parseFloat(orders[0].total_amount) : 0;

    // Generate delivery OTP
    const otp = generateDeliveryOTP();
    await pool.query(`UPDATE orders SET delivery_otp = ? WHERE id = ?`, [otp, order_id]);

    const [assignment] = await pool.query(
      `INSERT INTO order_assignments (order_id, rider_id, cod_amount, distance_km, estimated_time_minutes, admin_notes, delivery_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order_id, rider_id, codAmount, distanceKm, estimatedMinutes, admin_notes || null, deliveryDate]
    );

    await pool.query(
      `UPDATE orders SET assigned_rider_id = ?, delivery_status = 'assigned' WHERE id = ?`,
      [rider_id, order_id]
    );

    // Notify rider via push + socket
    emitToRider(rider_id, "order:new_assignment", {
      assignment_id: assignment.insertId,
      order_id,
      total_amount: orders[0].total_amount,
      distance_km: distanceKm,
      estimated_minutes: estimatedMinutes,
    });

    await sendToRider(rider_id, "New Order Assigned!", `Order #${order_id} - ₹${orders[0].total_amount}`, {
      type: "order_assigned",
      order_id: String(order_id),
      assignment_id: String(assignment.insertId),
    });

    await createNotification("rider", rider_id,
      "New Order Assigned",
      `Order #${order_id} worth ₹${orders[0].total_amount} has been assigned to you.`,
      "order_assigned",
      { order_id, assignment_id: assignment.insertId }
    );

    return res.json({
      success: true,
      message: "Order assigned to rider",
      assignment: {
        id: assignment.insertId,
        order_id,
        rider_id,
        distance_km: distanceKm,
        estimated_minutes: estimatedMinutes,
        delivery_otp: otp,
      },
    });
  } catch (error) {
    console.error("Assign order error:", error);
    return res.status(500).json({ success: false, message: "Failed to assign order" });
  }
};

export const getSuggestions = async (req, res) => {
  try {
    const { orderId } = req.params;
    const riders = await suggestRidersForOrder(orderId);
    return res.json({ success: true, riders });
  } catch (error) {
    console.error("Get suggestions error:", error);
    return res.status(500).json({ success: false, message: "Failed to get suggestions" });
  }
};

export const getNearbyRiders = async (req, res) => {
  try {
    const { orderId } = req.params;
    const radius = parseFloat(req.query.radius) || 3;

    const [orders] = await pool.query(
      `SELECT a.latitude, a.longitude FROM orders o LEFT JOIN newaddresses a ON o.address_id = a.id WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0 || !orders[0].latitude) {
      return res.json({ success: true, riders: [] });
    }

    const riders = await findNearbyActiveRiders(
      parseFloat(orders[0].latitude),
      parseFloat(orders[0].longitude),
      radius
    );

    return res.json({ success: true, riders });
  } catch (error) {
    console.error("Get nearby riders error:", error);
    return res.status(500).json({ success: false, message: "Failed to find nearby riders" });
  }
};

export const reassignOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { rider_id } = req.body;

    if (!rider_id) {
      return res.status(400).json({ success: false, message: "New rider ID required" });
    }

    const [assignments] = await pool.query(`SELECT * FROM order_assignments WHERE id = ?`, [id]);
    if (assignments.length === 0) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }

    // Mark old assignment as failed
    await pool.query(
      `UPDATE order_assignments SET status = 'failed', admin_notes = CONCAT(COALESCE(admin_notes, ''), ' [Reassigned]') WHERE id = ?`,
      [id]
    );

    // Create new assignment
    const orderId = assignments[0].order_id;
    const [newAssignment] = await pool.query(
      `INSERT INTO order_assignments (order_id, rider_id, cod_amount, admin_notes) VALUES (?, ?, ?, 'Reassigned from previous rider')`,
      [orderId, rider_id, assignments[0].cod_amount]
    );

    await pool.query(
      `UPDATE orders SET assigned_rider_id = ?, delivery_status = 'assigned' WHERE id = ?`,
      [rider_id, orderId]
    );

    emitToRider(rider_id, "order:new_assignment", {
      assignment_id: newAssignment.insertId,
      order_id: orderId,
    });

    await sendToRider(rider_id, "New Order Assigned!", `Order #${orderId} has been reassigned to you.`, {
      type: "order_assigned",
      order_id: String(orderId),
    });

    return res.json({
      success: true,
      message: "Order reassigned",
      assignment_id: newAssignment.insertId,
    });
  } catch (error) {
    console.error("Reassign order error:", error);
    return res.status(500).json({ success: false, message: "Failed to reassign order" });
  }
};
