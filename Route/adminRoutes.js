import express from "express";
import { adminController } from "../controller/admin/adminAuthController.js";
import { adminMiddleware } from "../middlewere/adminMiddleware.js";
import { fetchUsers } from "../controller/user/userController.js";
import { getDashboardStats } from "../controller/admin/dashboardController.js";
import { getAdminNotifications, markAdminNotificationsRead } from "../controller/admin/notificationAdminController.js";
import { runDailyScheduler } from "../services/schedulerService.js";
import { uploadsingleimg } from "../helper/storageImage.js";
import fs from "fs";

const routes = express.Router();

// Public routes
routes.post("/login", adminController.adminLogin);
routes.get("/verify", adminController.adminVerify);
routes.get("/logout", adminController.adminLogout);

// Protected routes (require admin authentication)
routes.get("/getadmin", adminMiddleware, adminController.getAdmin);
routes.put("/update-password", adminMiddleware, adminController.updateAdminPassword);
routes.get("/users", adminMiddleware, fetchUsers);
routes.get("/dashboard/stats", adminMiddleware, getDashboardStats);
routes.get("/notifications", adminMiddleware, getAdminNotifications);
routes.put("/notifications/read", adminMiddleware, markAdminNotificationsRead);

// Debug / Trigger route
routes.post("/trigger-scheduler", async (req, res) => {
  try {
    await runDailyScheduler();
    return res.json({ success: true, message: "Scheduler triggered manually." });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin image upload for rich-text editors (Jodit)
routes.post(
  "/upload",
  (req, res, next) => {
    try {
      const logMsg = `[${new Date().toISOString()}] BEFORE AUTH: Request received. Headers: ${JSON.stringify(req.headers)}, Cookies: ${JSON.stringify(req.cookies || {})}\n`;
      fs.appendFileSync("upload_debug.log", logMsg);
    } catch (e) {
      console.error("Failed to write before auth log", e);
    }
    next();
  },
  adminMiddleware,
  (req, res, next) => {
    try {
      const logMsg = `[${new Date().toISOString()}] AFTER AUTH: Admin user verified: ${req.admin?.id} - ${req.admin?.email}\n`;
      fs.appendFileSync("upload_debug.log", logMsg);
    } catch (e) {
      console.error("Failed to write after auth log", e);
    }
    next();
  },
  uploadsingleimg.array("files"),
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        fs.appendFileSync("upload_debug.log", `[${new Date().toISOString()}] FAILED: No files uploaded. Body: ${JSON.stringify(req.body)}\n`);
        return res.status(400).json({ success: false, message: "No files uploaded" });
      }
      const fileNames = req.files.map(file => file.filename);
      const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
      fs.appendFileSync("upload_debug.log", `[${new Date().toISOString()}] SUCCESS: Files saved: ${JSON.stringify(fileNames)}. BaseUrl: ${baseUrl}\n`);
      return res.status(200).json({
        success: true,
        error: 0,
        files: fileNames,
        baseurl: baseUrl,
        path: baseUrl + fileNames[0],
        message: "Upload successful",
        msg: "Upload successful",
        data: {
          success: true,
          error: 0,
          files: fileNames,
          baseurl: baseUrl,
          path: baseUrl + fileNames[0],
          message: "Upload successful",
          msg: "Upload successful"
        }
      });
    } catch (error) {
      console.error("Upload error:", error);
      try {
        fs.appendFileSync("upload_debug.log", `[${new Date().toISOString()}] ERROR: ${error.message}\n`);
      } catch (e) {}
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

export default routes;
