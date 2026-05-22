import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const { default: db } = await import("./config/db.js");

async function migrate() {
  try {
    console.log("Starting migrations...");

    // 1. Add is_best_seller and variants to products
    const [prodCols] = await db.query("SHOW COLUMNS FROM products");
    const hasBestSeller = prodCols.some(col => col.Field === "is_best_seller");
    const hasVariants = prodCols.some(col => col.Field === "variants");

    if (!hasBestSeller) {
      await db.query("ALTER TABLE products ADD COLUMN is_best_seller TINYINT(1) NOT NULL DEFAULT 0");
      console.log("Added column is_best_seller to products table");
    } else {
      console.log("Column is_best_seller already exists in products table");
    }

    if (!hasVariants) {
      await db.query("ALTER TABLE products ADD COLUMN variants LONGTEXT NULL");
      console.log("Added column variants to products table");
    } else {
      console.log("Column variants already exists in products table");
    }

    // 2. Add variant_name to carts
    const [cartCols] = await db.query("SHOW COLUMNS FROM carts");
    const hasCartVariant = cartCols.some(col => col.Field === "variant_name");
    if (!hasCartVariant) {
      await db.query("ALTER TABLE carts ADD COLUMN variant_name VARCHAR(255) DEFAULT NULL");
      console.log("Added column variant_name to carts table");
    } else {
      console.log("Column variant_name already exists in carts table");
    }

    // 3. Add variant_name to order_items
    const [orderItemCols] = await db.query("SHOW COLUMNS FROM order_items");
    const hasOrderItemVariant = orderItemCols.some(col => col.Field === "variant_name");
    if (!hasOrderItemVariant) {
      await db.query("ALTER TABLE order_items ADD COLUMN variant_name VARCHAR(255) DEFAULT NULL");
      console.log("Added column variant_name to order_items table");
    } else {
      console.log("Column variant_name already exists in order_items table");
    }

    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
}

migrate();
