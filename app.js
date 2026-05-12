import express from "express"
import { createServer } from "http"
import dotenv  from "dotenv";
import cors from "cors"
import CategoryRoute from "./Route/CategoryRouters.js"
import ProductRoute from "./Route/ProductRouters.js"
import BannerRoutes from "./Route/BannerRoutes.js"
import loginSignup from "./Route/signupinRoutes.js"
import CartRoute from "./Route/cartRoutes.js"
import cookieParser from "cookie-parser";
import AddressRoute from "./Route/addressRoutes.js"
import orderRoute from "./Route/orderRoutes.js"
import blogRoute from "./Route/blogRoute.js"
import razorpayRoutes from "./Route/Razerpay.js"
import paymentLinkRoutes from "./Route/paymentLinkRoutes.js"
import webhookRoutes from "./Route/webhookRoutes.js"
import paymentAdminRoutes from "./Route/paymentAdminRoutes.js"
import orderAdminRoutes from "./Route/orderAdminRoutes.js"
import offerRoutes from "./Route/offerRoutes.js"
import newsletterRoutes from "./Route/newsletterRoutes.js"
import db from "./config/db.js"   
import adminRoutes from "./Route/adminRoutes.js"
import userRoutes from "./Route/userRoutes.js";

import riderAuthRoutes from "./Route/riderAuthRoutes.js"
import riderRoutes from "./Route/riderRoutes.js"
import riderAdminRoutes from "./Route/riderAdminRoutes.js"
import assignmentRoutes from "./Route/assignmentRoutes.js"
import settlementRoutes from "./Route/settlementRoutes.js"
import wishlistRoutes from "./Route/wishlistRoutes.js"
import { initSocket } from "./services/socketService.js"


dotenv.config()


const app= express()  

app.use(
  cors({
    // Allow all origins (reflect request origin). Works with `credentials: true`.
    origin: (origin, callback) => callback(null, true),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Webhook routes need raw body for signature verification
// Must be registered before express.json() middleware
// app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);
// Production-compatible webhook endpoint (as requested)
// Keep raw body for signature verification
// app.use("/api/webhook", express.raw({ type: "application/json" }), webhookRoutes);
// Razorpay dashboard configured endpoint
app.use("/api/webhook-rz", express.raw({ type: "application/json" }), webhookRoutes);

// Log webhook endpoint registration
console.log("🔔 Webhook endpoint registered at: /api/webhook");
console.log("🔔 Webhook endpoint registered at: /api/webhook/razorpay");
console.log("🔔 Webhook endpoint registered at: /api/webhook-rz (Razorpay Dashboard)");

app.use(express.json())
app.use(cookieParser())
app.use("/uploads", express.static("uploads"));

app.get("/",async(req,res)=>{
  return res.json({ working:true})
})


 //admin authentication routes
app.use("/admin", adminRoutes);

//admin protected routes (add middleware later if needed)
app.use("/admin/category",CategoryRoute);
app.use("/admin/product",ProductRoute);
app.use("/admin/banner",BannerRoutes);
app.use("/admin/blog",blogRoute)
app.use("/admin/payments", paymentAdminRoutes);
app.use("/admin/orders", orderAdminRoutes);
app.use("/admin/offers", offerRoutes);

// all
app.use("/api/user/category",CategoryRoute)
app.use("/api/user/getproduct",ProductRoute)
app.use("/api/user/banner",BannerRoutes)

app.use("/api/user/",loginSignup)

// users
app.use("/api/user/cart",CartRoute)
app.use("/api/user/address",AddressRoute)
app.use("/api/user/order",orderRoute)
app.use("/api/user/payment-links", paymentLinkRoutes);
app.use("/api/newsletter", newsletterRoutes);

app.use('/api/user/razorpay', razorpayRoutes);
app.use("/api/user/wishlist", wishlistRoutes);

app.use("/api/users", userRoutes);

// Rider routes
app.use("/api/rider/auth", riderAuthRoutes);
app.use("/api/rider", riderRoutes);

// Admin rider management routes
app.use("/admin/riders", riderAdminRoutes);
app.use("/admin/assignments", assignmentRoutes);
app.use("/admin/settlements", settlementRoutes);

const PORT = process.env.PORT || 9002;

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`)
})
