import Razorpay  from "razorpay";
import crypto from "crypto";
import pool from "../../config.js";
import { notifyUser } from "../../services/firebaseService.js";

 const razorpay= new  Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
 })


 // Get Razorpay key for frontend
export const getRazorpayKey = async (req, res) => {
  try {
    return res.json({ 
      success: true, 
      key_id: process.env.RAZORPAY_KEY_ID 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to get Razorpay key" });
  }
}

export const createOrder= async (req,res)=>{
 try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid amount. Amount must be greater than 0." 
      });
    }

    const options = {
      amount: Math.round(amount * 100), // amount in paise, ensure it's an integer
      currency: "INR",
      receipt: "receipt_order_" + Math.floor(Math.random() * 10000),
    };

    console.log("Creating Razorpay order with options:", { ...options, amount: options.amount + " paise" });
    
    const order = await razorpay.orders.create(options);
    
    console.log("Razorpay order created:", order.id);
    
    return  res.json({ success: true, order });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create order",
      error: error.message || "Unknown error"
    });
  }
 }


export const createOrderDevBypass = async (req, res) => {
  try {
    const bypassEnabled =
      process.env.NODE_ENV !== "production" ||
      process.env.ENABLE_DEV_ORDER_BYPASS === "true";

    if (!bypassEnabled) {
      return res.status(403).json({
        success: false,
        message: "Dev bypass is disabled. Set ENABLE_DEV_ORDER_BYPASS=true to allow it.",
      });
    }

    const site_user_id = req.user.id;
    const { address_id, cart_items, total_amount, type, selectedDates } = req.body;

    if (!address_id) {
      return res.status(400).json({ success: false, message: "address_id is required" });
    }
    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ success: false, message: "cart_items are required" });
    }
    if (!total_amount || Number(total_amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid total_amount" });
    }

    const typeMapping = {
      one_time: "onetime",
      daily: "daily",
      alternative: "alternative",
      weekly: "weekly",
      monthly: "monthly",
    };
    const dbType = typeMapping[type] || "onetime";

    let alternativeDatesJson = null;
    if (dbType === "alternative") {
      if (!selectedDates || !Array.isArray(selectedDates) || selectedDates.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Alternative orders must have at least one selected date",
        });
      }
      alternativeDatesJson = JSON.stringify(
        selectedDates.map((date) => {
          const d = new Date(date);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${year}-${month}-${day}`;
        })
      );
    }

    const [orderResult] = await pool.query(
      `INSERT INTO orders (site_user_id, address_id, total_amount, status, payment_status, type, alternative_dates)
       VALUES (?, ?, ?, 'processing', 'paid', ?, ?)`,
      [site_user_id, address_id, total_amount, dbType, alternativeDatesJson]
    );

    const orderId = orderResult.insertId;

    for (const item of cart_items) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price, start_date)
         VALUES (?, ?, ?, ?, CURDATE())`,
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    return res.json({
      success: true,
      message: "Order placed in development mode (payment bypassed)",
      order_id: orderId,
      payment_status: "paid",
      bypassed_payment: true,
    });
  } catch (error) {
    console.error("Error in createOrderDevBypass:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to place order in dev bypass mode",
    });
  }
};


export const verifyOrder = async (req, res) => {
  let connection;
  try {
    const site_user_id = req.user.id;

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_method = "razorpay", // 'razorpay' or 'wallet'

      address_id,
      cart_items,
      total_amount,
      type,
      selectedDates,
      custom_delivery_dates
    } = req.body;

    if (!address_id) {
      return res.status(400).json({ success: false, message: "address_id is required" });
    }
    if (!Array.isArray(cart_items) || cart_items.length === 0) {
      return res.status(400).json({ success: false, message: "cart_items are required" });
    }
    if (!total_amount || Number(total_amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid total_amount" });
    }

    // Map frontend type values to database enum values
    const typeMapping = {
      'one_time': 'onetime',
      'daily': 'daily',
      'alternative': 'alternative',
      'weekly': 'weekly',
      'monthly': 'monthly',
      'custom_dates': 'custom_dates'
    };
    const dbType = typeMapping[type] || 'onetime';

    // Format dates array to YYYY-MM-DD JSON string
    const datesToSave = custom_delivery_dates || selectedDates;
    let datesJson = null;
    if (dbType === 'alternative' || dbType === 'custom_dates') {
      if (!datesToSave || !Array.isArray(datesToSave) || datesToSave.length === 0) {
        return res.status(400).json({
          success: false,
          message: `${type} orders must have at least one selected date`
        });
      }
      datesJson = JSON.stringify(
        datesToSave.map(date => {
          const d = new Date(date);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        })
      );
    }

    if (payment_method === "wallet") {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Check balance
      const [wallets] = await connection.query(
        `SELECT id, main_balance, cashback_balance, (main_balance + cashback_balance) AS total_balance 
         FROM wallets WHERE user_id = ? FOR UPDATE`,
        [site_user_id]
      );

      let wallet;
      if (wallets.length === 0) {
        // Create wallet if not exists
        const [newWallet] = await connection.query(`INSERT INTO wallets (user_id) VALUES (?)`, [site_user_id]);
        wallet = { id: newWallet.insertId, main_balance: 0.00, cashback_balance: 0.00, total_balance: 0.00 };
      } else {
        wallet = wallets[0];
      }

      const totalBill = parseFloat(total_amount);
      const mainBal = parseFloat(wallet.main_balance);
      const cashbackBal = parseFloat(wallet.cashback_balance);
      const totalBal = mainBal + cashbackBal;

      if (totalBal < totalBill) {
        connection.release();
        return res.status(400).json({
          success: false,
          error_code: "INSUFFICIENT_WALLET_BALANCE",
          message: `Insufficient wallet balance (₹${totalBal.toFixed(2)}) to complete this payment of ₹${totalBill.toFixed(2)}. Please top up your wallet.`
        });
      }

      // Deduct cashback balance first, then main balance
      let cashbackDeduct = 0.00;
      let mainDeduct = 0.00;

      if (cashbackBal >= totalBill) {
        cashbackDeduct = totalBill;
      } else {
        cashbackDeduct = cashbackBal;
        mainDeduct = totalBill - cashbackBal;
      }

      const newCashbackBal = cashbackBal - cashbackDeduct;
      const newMainBal = mainBal - mainDeduct;

      // Update wallet balance
      await connection.query(
        `UPDATE wallets SET main_balance = ?, cashback_balance = ? WHERE id = ?`,
        [newMainBal, newCashbackBal, wallet.id]
      );

      // Insert Order into DB with 'paid' status
      const [orderResult] = await connection.query(
        `INSERT INTO orders (site_user_id, address_id, total_amount, status, payment_status, type, alternative_dates, custom_delivery_dates, payment_method)
         VALUES (?, ?, ?, 'processing', 'paid', ?, ?, ?, 'wallet')`,
        [site_user_id, address_id, totalBill, dbType, datesJson, datesJson]
      );
      const orderId = orderResult.insertId;

      // Insert order items
      for (const item of cart_items) {
        await connection.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price, start_date)
           VALUES (?, ?, ?, ?, CURDATE())`,
          [orderId, item.product_id, item.quantity, item.price]
        );
      }

      // Insert Wallet Transaction debit
      await connection.query(
        `INSERT INTO wallet_transactions (wallet_id, type, source, amount, main_amount, cashback_amount, reference_id, title, description, status)
         VALUES (?, 'debit', 'order_payment', ?, ?, ?, ?, 'Order Payment', ?, 'success')`,
        [
          wallet.id,
          totalBill,
          mainDeduct,
          cashbackDeduct,
          String(orderId),
          `Paid for order #${orderId} using Gaualla Wallet`
        ]
      );

      // Insert into main transactions log
      try {
        await connection.query(
          `INSERT INTO transactions (site_user_id, order_id, amount, status, captured, payment_method, description)
           VALUES (?, ?, ?, 'captured', true, 'wallet', ?)`,
          [
            site_user_id,
            orderId,
            totalBill,
            `Paid via Wallet: main ₹${mainDeduct}, cashback ₹${cashbackDeduct}`
          ]
        );
      } catch (txnErr) {
        console.warn("⚠️ Non-critical error logging main transaction:", txnErr.message);
      }

      await connection.commit();
      connection.release();
      connection = null;

      // Notify User
      notifyUser(site_user_id, "Order Placed!", `Your order #${orderId} has been successfully paid via Wallet.`, "new_order", { order_id: String(orderId) }).catch(() => {});

      return res.json({
        success: true,
        message: "Payment successful. Order processed via Wallet.",
        order_id: orderId,
        deduction_summary: {
          deducted_from_main: mainDeduct,
          deducted_from_cashback: cashbackDeduct,
          remaining_wallet_balance: newMainBal + newCashbackBal
        }
      });

    } else {
      // Standard Razorpay Order Verification Flow
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: "Missing Razorpay payment parameters" });
      }

      const sign = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSign = crypto
        .createHmac("sha256", razorpay.key_secret)
        .update(sign.toString())
        .digest("hex");

      if (razorpay_signature !== expectedSign) {
        return res.status(400).json({ success: false, message: "Invalid signature" });
      }

      const [orderResult] = await pool.query(
        `INSERT INTO orders (site_user_id, address_id, total_amount, status, payment_status, type, alternative_dates, custom_delivery_dates, payment_method)
         VALUES (?, ?, ?, 'pending', 'pending', ?, ?, ?, 'razorpay')`,
        [site_user_id, address_id, total_amount, dbType, datesJson, datesJson]
      );

      const orderId = orderResult.insertId;

      for (const item of cart_items) {
        await pool.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price, start_date)
           VALUES (?, ?, ?, ?, CURDATE())`,
          [orderId, item.product_id, item.quantity, item.price]
        );
      }

      try {
        const [existing] = await pool.query(
          `SELECT id FROM transactions WHERE razorpay_payment_id = ?`,
          [razorpay_payment_id]
        );

        if (existing.length > 0) {
          await pool.query(
            `UPDATE transactions SET order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE razorpay_payment_id = ?`,
            [orderId, razorpay_payment_id]
          );
          
          const [txn] = await pool.query(
            `SELECT status, captured FROM transactions WHERE razorpay_payment_id = ?`,
            [razorpay_payment_id]
          );
          if (txn.length > 0 && txn[0].captured && txn[0].status === 'captured') {
            await pool.query(
              `UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = ?`,
              [orderId]
            );
          } else {
            const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
            if (paymentDetails.status === 'captured' || paymentDetails.captured === true) {
              await pool.query(
                `UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = ?`,
                [orderId]
              );
              await pool.query(
                `UPDATE transactions SET status = 'captured', captured = true WHERE razorpay_payment_id = ?`,
                [razorpay_payment_id]
              );
            }
          }
        } else {
          let initialStatus = "authorized";
          let captured = false;
          
          try {
            const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
            if (paymentDetails.status === 'captured' || paymentDetails.captured === true) {
              initialStatus = "captured";
              captured = true;
              await pool.query(
                `UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = ?`,
                [orderId]
              );
            }
          } catch (e) {
            console.error("Razorpay payment fetch failed:", e.message);
          }

          await pool.query(
            `INSERT INTO transactions (
              razorpay_payment_id, razorpay_order_id, order_id, site_user_id,
              amount, currency, status, captured, payment_method
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              razorpay_payment_id,
              razorpay_order_id,
              orderId,
              site_user_id,
              total_amount,
              "INR",
              initialStatus,
              captured,
              "razorpay"
            ]
          );
        }
      } catch (txErr) {
        console.error("⚠️ Transaction record error (non-blocking):", txErr.message);
      }

      notifyUser(site_user_id, "Order Confirmed!", `Your order #${orderId} has been placed successfully.`, "new_order", { order_id: String(orderId) }).catch(() => {});

      return res.json({
        success: true,
        message: "Order created. Payment confirmation pending via webhook.",
        order_id: orderId,
        payment_status: "pending"
      });
    }
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("❌ Error in verifyOrder:", error);
    res.status(500).json({
      success: false,
      message: "Verification failed",
      error: error.message
    });
  }
};

export const payViaWallet = async (req, res) => {
  req.body.payment_method = "wallet";
  return verifyOrder(req, res);
};


export const getOrder = async (req, res) => {
  try {
    const user_id = req.user.id;

    // 1. Get all orders for the user
    const [orders] = await pool.query(
      `SELECT o.*, a.first_name, a.last_name, a.street, a.city, a.state, a.zip_code, a.country
       FROM orders o
       LEFT JOIN newaddresses a ON o.address_id = a.id
       WHERE o.site_user_id = ?
       ORDER BY o.created_at DESC`,
      [user_id]
    );

    // 2. Fetch items + product details for each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const [items] = await pool.query(
          `SELECT oi.*, p.name AS product_name, p.images AS product_image
           FROM order_items oi
           LEFT JOIN products p ON oi.product_id = p.id
           WHERE oi.order_id = ?`,
          [order.id]
        );

        return {
          ...order,
          address: {
            first_name: order.first_name,
            last_name: order.last_name,
            street: order.street,
            city: order.city,
            state: order.state,
            zip_code: order.zip_code,
            country: order.country,
          },
          items,
        };
      })
    );
console.log(ordersWithItems)
    return res.json({ success: true, orders: ordersWithItems });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch orders" });
  }
};


export const getSingleOrder = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Get the order with address and rider details
    const [orders] = await pool.query(
      `SELECT o.*, a.first_name, a.last_name, a.street, a.city, a.state, a.zip_code, a.country, a.latitude, a.longitude,
              r.name AS delivery_man_name, r.phone AS delivery_man_phone, r.vehicle_type, r.vehicle_number
       FROM orders o
       LEFT JOIN newaddresses a ON o.address_id = a.id
       LEFT JOIN riders r ON o.assigned_rider_id = r.id
       WHERE o.id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orders[0]; // since we're fetching by ID, it's a single order

    // 2. Fetch items + product details for this order
    const [items] = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.images AS product_image
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [order.id]
    );

    // Format custom delivery dates
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

    // Format delivery vehicle info
    let deliveryVehicle = null;
    if (order.vehicle_type) {
      deliveryVehicle = `${order.vehicle_type}${order.vehicle_number ? ` ${order.vehicle_number}` : ""}`.trim();
    }

    // 3. Build the response
    const orderWithItems = {
      ...order,
      custom_delivery_dates: customDates,
      daily_deliveries_summary: dailyDeliveriesSummary,
      delivery_man_name: order.delivery_man_name || null,
      delivery_man_phone: order.delivery_man_phone || null,
      delivery_man_vehicle: deliveryVehicle,
      address: {
        first_name: order.first_name,
        last_name: order.last_name,
        street: order.street,
        city: order.city,
        state: order.state,
        zip_code: order.zip_code,
        country: order.country,
        latitude: order.latitude,
        longitude: order.longitude,
      },
      items,
    };

    // Clean up internal raw properties from order root level
    delete orderWithItems.vehicle_type;
    delete orderWithItems.vehicle_number;

    return res.json({ success: true, order: orderWithItems });
  } catch (error) {
    console.error("Error fetching order:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch order" });
  }
};
