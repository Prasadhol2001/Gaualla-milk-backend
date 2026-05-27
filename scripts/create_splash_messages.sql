-- ============================================================
-- Migration: Create splash_messages table
-- Run this in your MySQL database to set up the feature.
-- ============================================================

CREATE TABLE IF NOT EXISTS splash_messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL               COMMENT 'Short headline shown on splash e.g. Happy Monday',
  message     TEXT NOT NULL                       COMMENT 'Body text shown below the title on splash screen',
  emoji       VARCHAR(20)  DEFAULT '🌟'           COMMENT 'Decorative emoji shown alongside the title',
  type        ENUM('greeting','event') DEFAULT 'greeting'
                                                  COMMENT 'greeting = daily/weekly, event = festival/special day',
  start_date  DATE NOT NULL                       COMMENT 'First date the message is shown (inclusive)',
  end_date    DATE NOT NULL                       COMMENT 'Last date the message is shown (inclusive)',
  is_active   TINYINT(1)   DEFAULT 1              COMMENT '1 = active, 0 = paused',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Index for the public API query (the hot path)
  INDEX idx_active_dates (is_active, start_date, end_date)
);

-- Sample data (optional — remove if you prefer a clean start)
INSERT INTO splash_messages (title, message, emoji, type, start_date, end_date, is_active)
VALUES
  ('Welcome to Gaualla! 🥛', 'Start your day with pure, farm-fresh dairy goodness delivered to your door.', '🥛', 'greeting', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 1);
