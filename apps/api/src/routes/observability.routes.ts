import { Router } from "express";
import { getObservabilityMetrics, postClientObservabilityEvent } from "../controllers/observability.controller.js";
import { authRateLimit } from "../middleware/authRateLimit.js";

export const observabilityRouter = Router();

observabilityRouter.post("/client-events", authRateLimit, postClientObservabilityEvent);
observabilityRouter.get("/metrics", getObservabilityMetrics);
