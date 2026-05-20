import express from "express";
import { userMiddleware } from "../middlewere/userMiddlewere.js";
import {
  getWalletInfo,
  createTopUpOrder,
  verifyTopUp,
  getTransactions
} from "../controller/user/walletController.js";

const route = express.Router();

// Apply userMiddleware to all wallet routes
route.use(userMiddleware);

route.get("/info", getWalletInfo);
route.post("/topup/create", createTopUpOrder);
route.post("/topup/verify", verifyTopUp);
route.get("/transactions", getTransactions);

export default route;
