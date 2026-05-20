import express from "express"
import { userMiddleware } from "../middlewere/userMiddlewere.js";
import {
  createOrder,
  createOrderDevBypass,
  getOrder,
  getSingleOrder,
  verifyOrder,
  getRazorpayKey,
  payViaWallet,
} from "../controller/user/razerpayController.js";
import { getOrderTracking, getNotifications, markNotificationsRead } from "../controller/user/trackingController.js";

const route = express.Router();

route.get("/key", userMiddleware, getRazorpayKey)
route.post("/create",userMiddleware,createOrder)
route.post("/create-dev", userMiddleware, createOrderDevBypass)
route.post("/verify",userMiddleware,verifyOrder)
route.post("/pay-wallet", userMiddleware, payViaWallet)
route.get("/getorder",userMiddleware,getOrder)
route.get("/getsingleorder/:id",userMiddleware,getSingleOrder)

// Tracking & notifications
route.get("/track/:id", userMiddleware, getOrderTracking)
route.get("/notifications", userMiddleware, getNotifications)
route.put("/notifications/read", userMiddleware, markNotificationsRead)

export default route