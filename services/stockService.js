import pool from "../config.js";

/**
 * Decrement stock for a list of items.
 * - If item has a variant_name: decrements the stock inside the variants JSON column.
 * - If no variant_name: decrements the base product stock column.
 * @param {Array} items - Array of objects containing product_id, quantity, and optionally variant_name
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const decrementStock = async (items, connection = pool) => {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = parseInt(item.quantity);
    const variantName = item.variant_name || null;

    if (!productId || isNaN(quantity) || quantity <= 0) continue;

    if (variantName) {
      // Decrement stock inside the variants JSON for the matching variant
      console.log(`📉 Decrementing variant "${variantName}" stock for product ID ${productId} by ${quantity}`);

      // Fetch current variants JSON
      const [[product]] = await connection.query(
        `SELECT variants FROM products WHERE id = ?`,
        [productId]
      );

      if (!product || !product.variants) {
        console.warn(`⚠️ No variants found for product ID ${productId}, skipping variant stock decrement.`);
        continue;
      }

      let variants;
      try {
        variants = typeof product.variants === "string"
          ? JSON.parse(product.variants)
          : product.variants;
      } catch (e) {
        console.error(`❌ Failed to parse variants for product ${productId}:`, e);
        continue;
      }

      if (!Array.isArray(variants)) {
        console.warn(`⚠️ Variants for product ${productId} is not an array.`);
        continue;
      }

      let variantFound = false;
      const updatedVariants = variants.map((v) => {
        if (v.name === variantName) {
          variantFound = true;
          const currentStock = parseInt(v.stock) || 0;
          return {
            ...v,
            stock: String(Math.max(0, currentStock - quantity)),
          };
        }
        return v;
      });

      if (!variantFound) {
        console.warn(`⚠️ Variant "${variantName}" not found in product ${productId}.`);
        continue;
      }

      await connection.query(
        `UPDATE products SET variants = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(updatedVariants), productId]
      );
    } else {
      // Decrement base product stock
      console.log(`📉 Decrementing base stock for product ID ${productId} by ${quantity}`);
      await connection.query(
        `UPDATE products SET stock = GREATEST(0, stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [quantity, productId]
      );
    }
  }
};

/**
 * Increment stock for a list of items (restocking).
 * - If item has a variant_name: increments the stock inside the variants JSON column.
 * - If no variant_name: increments the base product stock column.
 * @param {Array} items - Array of objects containing product_id, quantity, and optionally variant_name
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const incrementStock = async (items, connection = pool) => {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = parseInt(item.quantity);
    const variantName = item.variant_name || null;

    if (!productId || isNaN(quantity) || quantity <= 0) continue;

    if (variantName) {
      // Increment stock inside the variants JSON for the matching variant
      console.log(`📈 Restocking variant "${variantName}" for product ID ${productId} by ${quantity}`);

      const [[product]] = await connection.query(
        `SELECT variants FROM products WHERE id = ?`,
        [productId]
      );

      if (!product || !product.variants) {
        console.warn(`⚠️ No variants found for product ID ${productId}, skipping variant stock increment.`);
        continue;
      }

      let variants;
      try {
        variants = typeof product.variants === "string"
          ? JSON.parse(product.variants)
          : product.variants;
      } catch (e) {
        console.error(`❌ Failed to parse variants for product ${productId}:`, e);
        continue;
      }

      if (!Array.isArray(variants)) {
        console.warn(`⚠️ Variants for product ${productId} is not an array.`);
        continue;
      }

      let variantFound = false;
      const updatedVariants = variants.map((v) => {
        if (v.name === variantName) {
          variantFound = true;
          const currentStock = parseInt(v.stock) || 0;
          return {
            ...v,
            stock: String(currentStock + quantity),
          };
        }
        return v;
      });

      if (!variantFound) {
        console.warn(`⚠️ Variant "${variantName}" not found in product ${productId}.`);
        continue;
      }

      await connection.query(
        `UPDATE products SET variants = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(updatedVariants), productId]
      );
    } else {
      // Increment base product stock
      console.log(`📈 Restocking base stock for product ID ${productId} by ${quantity}`);
      await connection.query(
        `UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [quantity, productId]
      );
    }
  }
};

/**
 * Restock all items associated with an order (e.g. on order cancellation/failure).
 * Correctly handles both variant and base stock.
 * @param {number|string} orderId - The order ID
 * @param {Object} [connection] - Optional db connection to run query inside a transaction
 */
export const restockOrderItems = async (orderId, connection = pool) => {
  try {
    // Fetch variant_name alongside product_id and quantity
    const [items] = await connection.query(
      `SELECT product_id, quantity, variant_name FROM order_items WHERE order_id = ?`,
      [orderId]
    );

    if (items.length > 0) {
      await incrementStock(items, connection);
    }
  } catch (error) {
    console.error(`❌ Failed to restock items for order #${orderId}:`, error);
  }
};
