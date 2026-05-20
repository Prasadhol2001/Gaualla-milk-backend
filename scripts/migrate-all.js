import db from "../config/db.js";

async function migrateAll() {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    console.log("🚀 Running full database migration...\n");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(255) DEFAULT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ users");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ admins");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_newsletter_email (email),
        UNIQUE KEY unique_newsletter_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ newsletter_subscribers");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        image VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ categories");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        offer_title VARCHAR(255) NOT NULL,
        offer_percent DECIMAL(5,2) NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        status ENUM('active','inactive','scheduled','expired') NOT NULL DEFAULT 'inactive',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_time (start_time, end_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ offers");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        category_id BIGINT(20) UNSIGNED NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        description2 TEXT DEFAULT NULL,
        price DECIMAL(8,2) NOT NULL,
        old_price DECIMAL(8,2) DEFAULT NULL,
        stock INT(11) NOT NULL,
        images LONGTEXT COLLATE utf8mb4_bin DEFAULT NULL,
        one_time TINYINT(1) NOT NULL DEFAULT 0,
        details LONGTEXT COLLATE utf8mb4_bin DEFAULT NULL,
        unit_quantity VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (category_id),
        CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ products");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS newaddresses (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id BIGINT(20) UNSIGNED NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        gender ENUM('male', 'female', 'other') DEFAULT NULL,
        email VARCHAR(150) DEFAULT NULL,
        phone VARCHAR(20) NOT NULL,
        street VARCHAR(255) NOT NULL,
        landmark VARCHAR(255) DEFAULT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        zip_code VARCHAR(20) NOT NULL,
        country VARCHAR(100) NOT NULL,
        address_type ENUM('home','work','office','other') DEFAULT 'home',
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        latitude DECIMAL(10,8) DEFAULT NULL,
        longitude DECIMAL(11,8) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (site_user_id),
        CONSTRAINT fk_newaddresses_user FOREIGN KEY (site_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await connection.query(`ALTER TABLE users ADD COLUMN fcm_token TEXT DEFAULT NULL`);
    } catch (_) {}
    try {
      await connection.query(`ALTER TABLE users ADD COLUMN device_platform VARCHAR(10) DEFAULT 'android'`);
    } catch (_) {}
    try {
      await connection.query(`
        ALTER TABLE newaddresses MODIFY COLUMN address_type ENUM('home','work','office','other') DEFAULT 'home'
      `);
    } catch (_) {}
    console.log("✅ newaddresses");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT(20) UNSIGNED DEFAULT NULL,
        product_id BIGINT(20) UNSIGNED NOT NULL,
        quantity INT(11) NOT NULL DEFAULT 1,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (product_id),
        CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ carts");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id BIGINT(20) UNSIGNED NOT NULL,
        address_id BIGINT(20) UNSIGNED DEFAULT NULL,
        total_amount DECIMAL(12,2) NOT NULL,
        status ENUM('pending','processing','out_for_delivery','completed','cancelled','refunded','on_hold_insufficient_funds') NOT NULL DEFAULT 'pending',
        payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
        type ENUM('onetime','daily','alternative','weekly','monthly') NOT NULL DEFAULT 'onetime',
        alternative_dates JSON DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user (site_user_id),
        INDEX idx_address (address_id),
        INDEX idx_status (status),
        INDEX idx_payment (payment_status),
        CONSTRAINT fk_order_user FOREIGN KEY (site_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_address FOREIGN KEY (address_id) REFERENCES newaddresses(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    try {
      await connection.query(`
        ALTER TABLE orders MODIFY COLUMN status ENUM('pending','processing','out_for_delivery','completed','cancelled','refunded','on_hold_insufficient_funds') NOT NULL DEFAULT 'pending'
      `);
    } catch (_) {}
    console.log("✅ orders");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id BIGINT(20) UNSIGNED NOT NULL,
        product_id BIGINT(20) UNSIGNED NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        price DECIMAL(12,2) NOT NULL,
        discount DECIMAL(12,2) DEFAULT 0,
        start_date DATE DEFAULT NULL,
        last_delivery_date DATE DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_order (order_id),
        INDEX idx_product (product_id),
        CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ order_items");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        image VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ banners");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS blogs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        img VARCHAR(255) NULL,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        writer VARCHAR(255) NOT NULL,
        short_description TEXT,
        yt_link VARCHAR(255) NULL,
        type ENUM('video','img') NOT NULL DEFAULT 'img',
        tag VARCHAR(255) DEFAULT NULL,
        readtime VARCHAR(50) DEFAULT NULL,
        full_description LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ blogs");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT(20) UNSIGNED NOT NULL,
        product_id BIGINT(20) UNSIGNED NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_wishlist (user_id, product_id),
        INDEX idx_user (user_id),
        INDEX idx_product (product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ wishlists");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS riders (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) DEFAULT NULL UNIQUE,
        phone VARCHAR(20) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        avatar VARCHAR(255) DEFAULT NULL,
        status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
        is_online TINYINT(1) NOT NULL DEFAULT 0,
        vehicle_type ENUM('bike','scooter','bicycle','van') DEFAULT 'bike',
        vehicle_number VARCHAR(50) DEFAULT NULL,
        current_latitude DECIMAL(10,8) DEFAULT NULL,
        current_longitude DECIMAL(11,8) DEFAULT NULL,
        last_location_update TIMESTAMP NULL DEFAULT NULL,
        fcm_token TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_online (is_online),
        INDEX idx_phone (phone),
        INDEX idx_location (current_latitude, current_longitude)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ riders");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_assignments (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id BIGINT(20) UNSIGNED NOT NULL,
        rider_id BIGINT(20) UNSIGNED NOT NULL,
        status ENUM('pending','accepted','rejected','picked_up','in_transit','delivered','failed') NOT NULL DEFAULT 'pending',
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP NULL DEFAULT NULL,
        picked_up_at TIMESTAMP NULL DEFAULT NULL,
        delivered_at TIMESTAMP NULL DEFAULT NULL,
        rejection_reason TEXT DEFAULT NULL,
        delivery_proof VARCHAR(255) DEFAULT NULL,
        cod_amount DECIMAL(10,2) DEFAULT 0,
        cod_collected TINYINT(1) NOT NULL DEFAULT 0,
        cod_settled TINYINT(1) NOT NULL DEFAULT 0,
        distance_km DECIMAL(6,2) DEFAULT NULL,
        estimated_time_minutes INT DEFAULT NULL,
        admin_notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_order (order_id),
        INDEX idx_rider (rider_id),
        INDEX idx_status (status),
        INDEX idx_assigned_at (assigned_at),
        CONSTRAINT fk_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_assignment_rider FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ order_assignments");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS rider_location_history (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        rider_id BIGINT(20) UNSIGNED NOT NULL,
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        speed DECIMAL(6,2) DEFAULT NULL,
        heading DECIMAL(5,2) DEFAULT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rider_time (rider_id, recorded_at),
        CONSTRAINT fk_location_rider FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ rider_location_history");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipient_type ENUM('admin','rider','user') NOT NULL,
        recipient_id BIGINT(20) UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT DEFAULT NULL,
        data JSON DEFAULT NULL,
        type ENUM('new_order','order_assigned','order_accepted','order_delivered','rider_nearby','payment_collected','general') NOT NULL DEFAULT 'general',
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recipient (recipient_type, recipient_id),
        INDEX idx_read (is_read),
        INDEX idx_type (type),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ notifications");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS rider_earnings (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        rider_id BIGINT(20) UNSIGNED NOT NULL,
        order_assignment_id BIGINT(20) UNSIGNED NOT NULL,
        delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
        cod_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        cod_settled TINYINT(1) NOT NULL DEFAULT 0,
        settlement_date DATE DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rider (rider_id),
        INDEX idx_assignment (order_assignment_id),
        INDEX idx_settled (cod_settled),
        INDEX idx_settlement_date (settlement_date),
        CONSTRAINT fk_earning_rider FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
        CONSTRAINT fk_earning_assignment FOREIGN KEY (order_assignment_id) REFERENCES order_assignments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ rider_earnings");

    const [deliveryCols] = await connection.query(`SHOW COLUMNS FROM orders LIKE 'delivery_status'`);
    if (deliveryCols.length === 0) {
      await connection.query(`
        ALTER TABLE orders
          ADD COLUMN assigned_rider_id BIGINT(20) UNSIGNED DEFAULT NULL,
          ADD COLUMN delivery_status ENUM('unassigned','assigned','accepted','picked_up','in_transit','delivered','failed') NOT NULL DEFAULT 'unassigned',
          ADD COLUMN estimated_delivery_time TIMESTAMP NULL DEFAULT NULL,
          ADD COLUMN delivery_otp VARCHAR(6) DEFAULT NULL,
          ADD INDEX idx_rider (assigned_rider_id),
          ADD INDEX idx_delivery_status (delivery_status),
          ADD CONSTRAINT fk_order_rider FOREIGN KEY (assigned_rider_id) REFERENCES riders(id) ON DELETE SET NULL
      `);
      console.log("✅ orders → delivery columns added");
    } else {
      console.log("✅ orders → delivery columns already exist");
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS payment_links (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        razorpay_payment_link_id VARCHAR(255) NOT NULL UNIQUE,
        order_id BIGINT(20) UNSIGNED DEFAULT NULL,
        site_user_id BIGINT(20) UNSIGNED NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        description TEXT DEFAULT NULL,
        customer_name VARCHAR(255) DEFAULT NULL,
        customer_email VARCHAR(255) DEFAULT NULL,
        customer_contact VARCHAR(20) DEFAULT NULL,
        payment_link_url TEXT NOT NULL,
        short_url VARCHAR(255) DEFAULT NULL,
        status ENUM('created','paid','expired','cancelled') NOT NULL DEFAULT 'created',
        expire_by INT UNSIGNED DEFAULT NULL,
        expired_at TIMESTAMP NULL DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        metadata JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_razorpay_id (razorpay_payment_link_id),
        INDEX idx_order (order_id),
        INDEX idx_user (site_user_id),
        INDEX idx_status (status),
        INDEX idx_expired_at (expired_at),
        CONSTRAINT fk_payment_link_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_payment_link_user FOREIGN KEY (site_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ payment_links");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        razorpay_payment_id VARCHAR(255) DEFAULT NULL,
        razorpay_order_id VARCHAR(255) DEFAULT NULL,
        payment_link_id BIGINT(20) UNSIGNED DEFAULT NULL,
        order_id BIGINT(20) UNSIGNED DEFAULT NULL,
        site_user_id BIGINT(20) UNSIGNED NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        status ENUM('pending','authorized','captured','failed','refunded','partially_refunded') NOT NULL DEFAULT 'pending',
        payment_method VARCHAR(50) DEFAULT NULL,
        payment_method_type VARCHAR(50) DEFAULT NULL,
        bank VARCHAR(100) DEFAULT NULL,
        wallet VARCHAR(100) DEFAULT NULL,
        vpa VARCHAR(255) DEFAULT NULL,
        card_id VARCHAR(255) DEFAULT NULL,
        invoice_id VARCHAR(255) DEFAULT NULL,
        international BOOLEAN DEFAULT FALSE,
        amount_refunded DECIMAL(12,2) DEFAULT 0,
        refund_status ENUM('null','partial','full') DEFAULT 'null',
        captured BOOLEAN DEFAULT FALSE,
        description TEXT DEFAULT NULL,
        fee DECIMAL(12,2) DEFAULT 0,
        tax DECIMAL(12,2) DEFAULT 0,
        error_code VARCHAR(50) DEFAULT NULL,
        error_description TEXT DEFAULT NULL,
        error_reason VARCHAR(255) DEFAULT NULL,
        error_source VARCHAR(50) DEFAULT NULL,
        error_step VARCHAR(50) DEFAULT NULL,
        razorpay_created_at INT UNSIGNED DEFAULT NULL,
        metadata JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_razorpay_payment_id (razorpay_payment_id),
        INDEX idx_razorpay_order_id (razorpay_order_id),
        INDEX idx_payment_link (payment_link_id),
        INDEX idx_order (order_id),
        INDEX idx_user (site_user_id),
        INDEX idx_status (status),
        INDEX idx_payment_method (payment_method),
        CONSTRAINT fk_transaction_payment_link FOREIGN KEY (payment_link_id) REFERENCES payment_links(id) ON DELETE SET NULL,
        CONSTRAINT fk_transaction_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_transaction_user FOREIGN KEY (site_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ transactions");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        razorpay_refund_id VARCHAR(255) NOT NULL UNIQUE,
        transaction_id BIGINT(20) UNSIGNED NOT NULL,
        payment_id VARCHAR(255) NOT NULL,
        order_id BIGINT(20) UNSIGNED DEFAULT NULL,
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        status ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
        speed VARCHAR(50) DEFAULT 'normal',
        notes TEXT DEFAULT NULL,
        receipt VARCHAR(255) DEFAULT NULL,
        batch_id VARCHAR(255) DEFAULT NULL,
        razorpay_created_at INT UNSIGNED DEFAULT NULL,
        metadata JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_razorpay_refund_id (razorpay_refund_id),
        INDEX idx_transaction (transaction_id),
        INDEX idx_payment_id (payment_id),
        INDEX idx_order (order_id),
        INDEX idx_status (status),
        CONSTRAINT fk_refund_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ refunds");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(255) NOT NULL UNIQUE,
        event_type VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(255) NOT NULL,
        payment_id VARCHAR(255) DEFAULT NULL,
        payment_link_id VARCHAR(255) DEFAULT NULL,
        order_id BIGINT(20) UNSIGNED DEFAULT NULL,
        amount DECIMAL(12,2) DEFAULT NULL,
        status VARCHAR(50) DEFAULT NULL,
        payload JSON NOT NULL,
        signature_verified BOOLEAN DEFAULT FALSE,
        processed BOOLEAN DEFAULT FALSE,
        error_message TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_event_id (event_id),
        INDEX idx_event_type (event_type),
        INDEX idx_entity_type (entity_type),
        INDEX idx_payment_id (payment_id),
        INDEX idx_payment_link_id (payment_link_id),
        INDEX idx_order (order_id),
        INDEX idx_processed (processed),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ webhook_events");

    // wallets and wallet_transactions tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT(20) UNSIGNED NOT NULL UNIQUE,
        main_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        cashback_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ wallets");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        wallet_id BIGINT(20) UNSIGNED NOT NULL,
        type ENUM('credit', 'debit') NOT NULL,
        source ENUM('topup', 'cashback', 'order_payment', 'subscription_deduction', 'refund', 'admin_adjustment') NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        main_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        cashback_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        reference_id VARCHAR(100) DEFAULT NULL,
        title VARCHAR(255) NOT NULL,
        description VARCHAR(500) DEFAULT NULL,
        status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wallet (wallet_id),
        INDEX idx_type (type),
        INDEX idx_source (source),
        CONSTRAINT fk_wallet_transaction_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ wallet_transactions");

    // Alter orders table to modify type and add columns if they don't exist
    try {
      await connection.query(`
        ALTER TABLE orders 
          MODIFY COLUMN type ENUM('onetime','daily','alternative','weekly','monthly','custom_dates') NOT NULL DEFAULT 'onetime'
      `);
      console.log("✅ orders → type ENUM modified to include custom_dates");
    } catch (e) {
      console.log("⚠️ Error modifying orders type ENUM:", e.message);
    }

    try {
      await connection.query(`
        ALTER TABLE orders
          ADD COLUMN payment_method ENUM('razorpay', 'wallet') NOT NULL DEFAULT 'razorpay'
      `);
      console.log("✅ orders → payment_method column added");
    } catch (_) {}

    try {
      await connection.query(`
        ALTER TABLE orders
          ADD COLUMN custom_delivery_dates JSON DEFAULT NULL
      `);
      console.log("✅ orders → custom_delivery_dates column added");
    } catch (_) {}

    await connection.commit();
    console.log("🎉 All migrations completed successfully!");
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

migrateAll()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

export default migrateAll;