import express from "express";
import { riderMiddleware } from "../middlewere/riderMiddleware.js";
import {
  getAssignedOrders,
  getActiveOrder,
  getOrderHistory,
  getOrderDetail,
  acceptOrder,
  rejectOrder,
  pickupOrder,
  startDelivery,
  deliverOrder,
  collectCOD,
  markFailed,
  getDashboardStats,
} from "../controller/rider/riderOrderController.js";
import {
  updateLocation,
  getCurrentLocation,
} from "../controller/rider/riderLocationController.js";
import {
  getEarningsSummary,
  getEarningsHistory,
} from "../controller/rider/riderEarningsController.js";

const router = express.Router();

// All routes require rider authentication
router.use(riderMiddleware);

// Dashboard
router.get("/dashboard", getDashboardStats);

// Orders
router.get("/orders/assigned", getAssignedOrders);
router.get("/orders/active", getActiveOrder);
router.get("/orders/history", getOrderHistory);
router.get("/orders/:id", getOrderDetail);
router.put("/orders/:id/accept", acceptOrder);
router.put("/orders/:id/reject", rejectOrder);
router.put("/orders/:id/pickup", pickupOrder);
router.put("/orders/:id/start-delivery", startDelivery);
router.put("/orders/:id/deliver", deliverOrder);
router.put("/orders/:id/fail", markFailed);
router.put("/orders/:id/collect-cod", collectCOD);

// Location
router.post("/location/update", updateLocation);
router.get("/location/current", getCurrentLocation);

// Earnings
router.get("/earnings/summary", getEarningsSummary);
router.get("/earnings/history", getEarningsHistory);

export default router;
