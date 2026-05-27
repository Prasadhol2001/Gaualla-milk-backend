import express from "express";
import { splashMessageController } from "../controller/admin/splashMessageController.js";
import { adminMiddleware } from "../middlewere/adminMiddleware.js";

const router = express.Router();

// ── Admin routes (protected) ──────────────────────────────────────────────────
router.get("/", adminMiddleware, splashMessageController.getAllMessages);
router.post("/", adminMiddleware, splashMessageController.createMessage);
router.put("/:id", adminMiddleware, splashMessageController.updateMessage);
router.delete("/:id", adminMiddleware, splashMessageController.deleteMessage);
router.patch("/:id/toggle", adminMiddleware, splashMessageController.toggleActive);

export default router;
