import pool from "../config.js";

/**
 * Decrement stock for a list of items
 * @param {Array} items - Array of objects containing product_id and quantity
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const decrementStock = async (items, connection = pool) => {
  if (!Array.isArray(items) || items.length === 0) return;
  
  for (const item of items) {
    const productId = item.product_id;
    const quantity = parseInt(item.quantity);
    
    if (!productId || isNaN(quantity) || quantity <= 0) continue;
    
    console.log(`📉 Decrementing stock for product ID ${productId} by ${quantity}`);
    await connection.query(
      `UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?`,
      [quantity, productId]
    );
  }
};

/**
 * Increment stock for a list of items (restocking)
 * @param {Array} items - Array of objects containing product_id and quantity
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const incrementStock = async (items, connection = pool) => {
  if (!Array.isArray(items) || items.length === 0) return;
  
  for (const item of items) {
    const productId = item.product_id;
    const quantity = parseInt(item.quantity);
    
    if (!productId || isNaN(quantity) || quantity <= 0) continue;
    
    console.log(`📈 Restocking product ID ${productId} by ${quantity}`);
    await connection.query(
      `UPDATE products SET stock = stock + ? WHERE id = ?`,
      [quantity, productId]
    );
  }
};

/**
 * Restock all items associated with an order (e.g. on order cancellation/failure)
 * @param {number|string} orderId - The order ID
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const restockOrderItems = async (orderId, connection = pool) => {
  try {
    const [items] = await connection.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = ?`,
      [orderId]
    );
    
    if (items.length > 0) {
      await incrementStock(items, connection);
    }
  } catch (error) {
    console.error(`❌ Failed to restock items for order #${orderId}:`, error);
  }
};
