import pool from "../config.js";
import { notifyUser } from "./firebaseService.js";

/**
 * Main execution logic for daily subscriptions and wallet deductions.
 * Finds all active subscriptions (daily, alternative, custom_dates, etc.)
 * scheduled for delivery today.
 */
export const runDailyScheduler = async () => {
  console.log("⏰ [Scheduler] Starting daily subscription execution check...");
  let connection;
  try {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayOfMonth = d.getDate();

    console.log(`⏰ [Scheduler] Running for date: ${todayStr}`);

    connection = await pool.getConnection();

    // 1. Fetch active subscription orders
    const [orders] = await connection.query(
      `SELECT id, site_user_id, type, alternative_dates, custom_delivery_dates, total_amount, payment_status, payment_method, status
       FROM orders
       WHERE status IN ('processing', 'on_hold_insufficient_funds')
         AND type IN ('daily', 'alternative', 'custom_dates', 'weekly', 'monthly')`
    );

    console.log(`⏰ [Scheduler] Found ${orders.length} potential subscription orders to evaluate.`);

    for (const order of orders) {
      let isScheduledToday = false;

      if (order.type === 'daily') {
        isScheduledToday = true;
      } else if (order.type === 'alternative' || order.type === 'custom_dates') {
        const datesJson = order.custom_delivery_dates || order.alternative_dates;
        if (datesJson) {
          try {
            const datesArray = typeof datesJson === 'string' ? JSON.parse(datesJson) : datesJson;
            if (Array.isArray(datesArray) && datesArray.includes(todayStr)) {
              isScheduledToday = true;
            }
          } catch (e) {
            console.error(`⏰ [Scheduler] Error parsing dates JSON for order #${order.id}:`, e.message);
          }
        }
      } else if (order.type === 'weekly') {
        const orderDate = new Date(order.created_at);
        if (orderDate.getDay() === dayOfWeek) {
          isScheduledToday = true;
        }
      } else if (order.type === 'monthly') {
        const orderDate = new Date(order.created_at);
        if (orderDate.getDate() === dayOfMonth) {
          isScheduledToday = true;
        }
      }

      if (!isScheduledToday) {
        continue;
      }

      console.log(`⏰ [Scheduler] Order #${order.id} is scheduled for delivery today.`);

      // 2. Fetch order items to calculate daily price
      const [items] = await connection.query(
        `SELECT product_id, quantity, price FROM order_items WHERE order_id = ?`,
        [order.id]
      );

      let dailyAmount = 0.00;
      for (const item of items) {
        dailyAmount += parseFloat(item.price) * parseInt(item.quantity);
      }

      // Check if order was already paid upfront (Razorpay checkout or full wallet checkout)
      const isUpfrontPaid = (order.payment_status === 'paid');

      if (isUpfrontPaid) {
        // Already paid upfront - no deduction needed. Log dispatch and continue.
        console.log(`⏰ [Scheduler] Order #${order.id} is already paid upfront. Dispatching delivery.`);
        
        // Log dispatch notification
        notifyUser(
          order.site_user_id,
          "Subscription Out for Delivery!",
          `Your daily subscription delivery for order #${order.id} is dispatched!`,
          "delivery_status",
          { order_id: String(order.id) }
        ).catch(() => {});
        
        // Ensure status is processing (in case it was on_hold)
        if (order.status !== 'processing') {
          await connection.query(
            `UPDATE orders SET status = 'processing' WHERE id = ?`,
            [order.id]
          );
        }
        continue;
      }

      // Deduct daily fee from wallet (pay-as-you-go flow)
      await connection.beginTransaction();
      try {
        // Lock wallet for update
        const [wallets] = await connection.query(
          `SELECT id, main_balance, cashback_balance FROM wallets WHERE user_id = ? FOR UPDATE`,
          [order.site_user_id]
        );

        let walletId;
        let mainBal = 0.00;
        let cashbackBal = 0.00;

        if (wallets.length === 0) {
          // Create wallet if it doesn't exist
          const [newWallet] = await connection.query(
            `INSERT INTO wallets (user_id, main_balance, cashback_balance) VALUES (?, 0, 0)`,
            [order.site_user_id]
          );
          walletId = newWallet.insertId;
        } else {
          walletId = wallets[0].id;
          mainBal = parseFloat(wallets[0].main_balance);
          cashbackBal = parseFloat(wallets[0].cashback_balance);
        }

        const totalBal = mainBal + cashbackBal;

        if (totalBal < dailyAmount) {
          // Insufficient funds: pause subscription
          console.log(`⏰ [Scheduler] Insufficient funds for order #${order.id} (user: ${order.site_user_id}). Required: ₹${dailyAmount}, Available: ₹${totalBal}. Putting on hold.`);
          
          await connection.query(
            `UPDATE orders SET status = 'on_hold_insufficient_funds' WHERE id = ?`,
            [order.id]
          );

          await connection.commit();

          // Notify User
          notifyUser(
            order.site_user_id,
            "Subscription Paused - Low Balance",
            `Your subscription delivery for today is paused due to insufficient wallet balance (₹${totalBal.toFixed(2)}). Please top up to resume deliveries!`,
            "general",
            { order_id: String(order.id) }
          ).catch(() => {});

        } else {
          // Deduct from wallet: cashback first, then main balance
          let cashbackDeduct = 0.00;
          let mainDeduct = 0.00;

          if (cashbackBal >= dailyAmount) {
            cashbackDeduct = dailyAmount;
          } else {
            cashbackDeduct = cashbackBal;
            mainDeduct = dailyAmount - cashbackBal;
          }

          const newCashback = cashbackBal - cashbackDeduct;
          const newMain = mainBal - mainDeduct;

          // Update balances
          await connection.query(
            `UPDATE wallets SET main_balance = ?, cashback_balance = ? WHERE id = ?`,
            [newMain, newCashback, walletId]
          );

          // Log transaction
          await connection.query(
            `INSERT INTO wallet_transactions (wallet_id, type, source, amount, main_amount, cashback_amount, reference_id, title, description, status)
             VALUES (?, 'debit', 'subscription_deduction', ?, ?, ?, ?, 'Subscription Daily Charge', ?, 'success')`,
            [
              walletId,
              dailyAmount,
              mainDeduct,
              cashbackDeduct,
              String(order.id),
              `Daily charge for subscription order #${order.id}`
            ]
          );

          // Update order status back to processing in case it was on hold
          await connection.query(
            `UPDATE orders SET status = 'processing', payment_status = 'paid' WHERE id = ?`,
            [order.id]
          );

          await connection.commit();
          console.log(`⏰ [Scheduler] Order #${order.id} successfully charged ₹${dailyAmount} and dispatched.`);

          // Notify User
          notifyUser(
            order.site_user_id,
            "Subscription Dispatched!",
            `₹${dailyAmount.toFixed(2)} deducted from your wallet. Today's subscription delivery is dispatched!`,
            "delivery_status",
            { order_id: String(order.id) }
          ).catch(() => {});
        }
      } catch (innerErr) {
        await connection.rollback();
        console.error(`⏰ [Scheduler] Rollback for order #${order.id} due to error:`, innerErr.message);
      }
    }

    connection.release();
    console.log("⏰ [Scheduler] Daily subscription execution check completed.");
  } catch (error) {
    if (connection) {
      connection.release();
    }
    console.error("⏰ [Scheduler] Error running daily scheduler:", error);
  }
};

/**
 * Schedules the runDailyScheduler function to run every night at 12:00 AM (midnight).
 */
export const startScheduler = () => {
  const now = new Date();
  
  // Calculate milliseconds until next midnight
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // Tomorrow
    0, 0, 0, 0         // 12:00 AM
  );

  const msToMidnight = nextMidnight.getTime() - now.getTime();
  
  console.log(`⏰ [Scheduler] Scheduler initialized. Next run in ${Math.round(msToMidnight / 1000 / 60)} minutes (at midnight local time).`);

  setTimeout(() => {
    // Run the scheduler
    runDailyScheduler();
    
    // Set up timer again for the following midnight
    startScheduler();
  }, msToMidnight);
};
