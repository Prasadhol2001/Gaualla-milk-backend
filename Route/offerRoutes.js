import express from "express";
import { adminMiddleware } from "../middlewere/adminMiddleware.js";
import {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  updateOfferStatus,
  deleteOffer,
} from "../controller/admin/offerController.js";

const router = express.Router();

router.use(adminMiddleware);

router.post("/", createOffer);
router.get("/", getAllOffers);
router.get("/:id", getOfferById);
router.put("/:id", updateOffer);
router.patch("/:id/status", updateOfferStatus);
router.delete("/:id", deleteOffer);

export default router;