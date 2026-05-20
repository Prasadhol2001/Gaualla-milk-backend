import Razorpay from "razorpay";
import crypto from "crypto";
import pool from "../../config.js";
import { notifyUser } from "../../services/firebaseService.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Calculate the cashback bonus based on top-up amount
 */
export function calculateTopupBonus(amount) {
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) return 0.00;
  
  let tierBonus = 0.00;
  if (amt >= 5000) tierBonus = 1000.00;
  else if (amt >= 2000) tierBonus = 300.00;
  else if (amt >= 1000) tierBonus = 100.00;
  
  let genericBonus = 0.00;
  if (amt > 500) {
    genericBonus = Math.round(amt * 0.05 * 100) / 100;
  }
  
  return Math.max(tierBonus, genericBonus);
}

/**
 * Get wallet details of the authenticated user.
 * Automatically creates a wallet if it doesn't exist (lazy init).
 */
export const getWalletInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if wallet exists
    let [wallets] = await pool.query(
      `SELECT id, main_balance, cashback_balance, (main_balance + cashback_balance) AS total_balance, status 
       FROM wallets WHERE user_id = ?`,
      [userId]
    );

    if (wallets.length === 0) {
      // Lazy initialize wallet
      await pool.query(`INSERT INTO wallets (user_id) VALUES (?)`, [userId]);
      
      return res.json({
        success: true,
        wallet: {
          main_balance: 0.00,
          cashback_balance: 0.00,
          total_balance: 0.00,
          status: "active"
        }
      });
    }

    const wallet = wallets[0];
    // Format balances to numbers
    wallet.main_balance = parseFloat(wallet.main_balance);
    wallet.cashback_balance = parseFloat(wallet.cashback_balance);
    wallet.total_balance = parseFloat(wallet.total_balance);

    return res.json({
      success: true,
      wallet
    });
  } catch (error) {
    console.error("Error in getWalletInfo:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet info"
    });
  }
};

/**
 * Create a Razorpay Order for wallet top-up
 */
export const createTopUpOrder = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0"
      });
    }

    const options = {
      amount: Math.round(amount * 100), // convert to paise
      currency: "INR",
      receipt: `topup_rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    };

    console.log(`Creating Razorpay top-up order for ₹${amount}`);
    const order = await razorpay.orders.create(options);

    return res.json({
      success: true,
      razorpay_order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency
      }
    });
  } catch (error) {
    console.error("Error in createTopUpOrder:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate top-up order"
    });
  }
};

/**
 * Verify Razorpay payment signature and credit wallet balance with bonus cashback.
 */
export const verifyTopUp = async (req, res) => {
  let connection;
  try {
    const userId = req.user.id;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing verification parameters"
      });
    }

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", razorpay.key_secret)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature"
      });
    }

    // Check if this payment has already been credited (idempotency)
    const [existingTxn] = await pool.query(
      `SELECT id FROM wallet_transactions WHERE reference_id = ? AND source = 'topup' AND status = 'success'`,
      [razorpay_payment_id]
    );

    if (existingTxn.length > 0) {
      return res.status(400).json({
        success: false,
        message: "This payment has already been processed and credited to your wallet"
      });
    }

    const topupAmount = parseFloat(amount);
    const cashbackAwarded = calculateTopupBonus(topupAmount);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Select or create wallet
    let [wallets] = await connection.query(
      `SELECT id, main_balance, cashback_balance FROM wallets WHERE user_id = ? FOR UPDATE`,
      [userId]
    );

    let walletId;
    let oldMain = 0.00;
    let oldCashback = 0.00;

    if (wallets.length === 0) {
      const [newWallet] = await connection.query(
        `INSERT INTO wallets (user_id, main_balance, cashback_balance) VALUES (?, 0, 0)`,
        [userId]
      );
      walletId = newWallet.insertId;
    } else {
      walletId = wallets[0].id;
      oldMain = parseFloat(wallets[0].main_balance);
      oldCashback = parseFloat(wallets[0].cashback_balance);
    }

    const newMain = oldMain + topupAmount;
    const newCashback = oldCashback + cashbackAwarded;

    // Update wallet balances
    await connection.query(
      `UPDATE wallets SET main_balance = ?, cashback_balance = ? WHERE id = ?`,
      [newMain, newCashback, walletId]
    );

    // Insert wallet transactions
    // 1. Log top-up deposit
    await connection.query(
      `INSERT INTO wallet_transactions (wallet_id, type, source, amount, main_amount, cashback_amount, reference_id, title, description, status)
       VALUES (?, 'credit', 'topup', ?, ?, 0.00, ?, 'Wallet Top-up', ?, 'success')`,
      [
        walletId,
        topupAmount,
        topupAmount,
        razorpay_payment_id,
        `Topped up ₹${topupAmount} via UPI/Card`
      ]
    );

    // 2. Log cashback award if earned
    if (cashbackAwarded > 0) {
      await connection.query(
        `INSERT INTO wallet_transactions (wallet_id, type, source, amount, main_amount, cashback_amount, reference_id, title, description, status)
         VALUES (?, 'credit', 'cashback', ?, 0.00, ?, ?, 'Top-up Cashback Bonus', ?, 'success')`,
        [
          walletId,
          cashbackAwarded,
          cashbackAwarded,
          razorpay_payment_id,
          `Promotional bonus of ₹${cashbackAwarded} credited`
        ]
      );
    }

    // Write record to main transaction registry (for unified payments logging)
    try {
      await connection.query(
        `INSERT INTO transactions (razorpay_payment_id, razorpay_order_id, site_user_id, amount, status, captured, payment_method, description)
         VALUES (?, ?, ?, ?, 'captured', true, 'wallet_topup', ?)`,
        [
          razorpay_payment_id,
          razorpay_order_id,
          userId,
          topupAmount,
          `Wallet topup of ₹${topupAmount}`
        ]
      );
    } catch (dbErr) {
      console.warn("⚠️ Non-critical error registering top-up transaction:", dbErr.message);
    }

    await connection.commit();
    connection.release();
    connection = null;

    // Send push notification asynchronously
    notifyUser(
      userId,
      "Wallet Credited!",
      `₹${topupAmount} has been credited to your wallet. ${cashbackAwarded > 0 ? `Plus, you earned ₹${cashbackAwarded} cashback!` : ""}`,
      "general"
    ).catch(() => {});

    return res.json({
      success: true,
      message: "Top-up verified and credited to wallet.",
      credited_amount: topupAmount,
      cashback_awarded: cashbackAwarded,
      wallet: {
        main_balance: newMain,
        cashback_balance: newCashback,
        total_balance: newMain + newCashback
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Error in verifyTopUp:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify top-up"
    });
  }
};

/**
 * Get wallet transactions log (paginated)
 */
export const getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = req.query.type; // 'credit' or 'debit'
    const source = req.query.source; // 'topup', 'cashback', etc.
    
    const offset = (page - 1) * limit;

    // Ensure wallet exists
    const [wallets] = await pool.query(`SELECT id FROM wallets WHERE user_id = ?`, [userId]);
    if (wallets.length === 0) {
      return res.json({
        success: true,
        current_page: page,
        total_pages: 0,
        transactions: []
      });
    }
    
    const walletId = wallets[0].id;
    
    // Construct dynamic filters
    let queryParams = [walletId];
    let whereClause = "WHERE wallet_id = ?";

    if (type) {
      whereClause += " AND type = ?";
      queryParams.push(type);
    }
    if (source) {
      whereClause += " AND source = ?";
      queryParams.push(source);
    }

    // Get total count for pagination
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM wallet_transactions ${whereClause}`,
      queryParams
    );
    const totalTransactions = countRows[0].total;
    const totalPages = Math.ceil(totalTransactions / limit);

    // Fetch transactions
    let fetchQuery = `
      SELECT id, type, source, amount, reference_id, title, description, status, created_at AS date
      FROM wallet_transactions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    // Pagination params must be passed as numbers
    queryParams.push(limit);
    queryParams.push(offset);

    const [transactions] = await pool.query(fetchQuery, queryParams);

    return res.json({
      success: true,
      current_page: page,
      total_pages: totalPages,
      transactions
    });
  } catch (error) {
    console.error("Error in getTransactions:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions"
    });
  }
};
