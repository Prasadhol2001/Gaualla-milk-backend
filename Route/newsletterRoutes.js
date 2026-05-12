import express from "express";
import { subscribeNewsletter, getNewsletterSubscribers } from "../controller/all/newsletterController.js";
import { adminMiddleware } from "../middlewere/adminMiddleware.js";

const router = express.Router();

router.post("/subscribe", subscribeNewsletter);
router.get("/subscribers", adminMiddleware, getNewsletterSubscribers);

export default router;