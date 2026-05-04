import { Router } from "express";
import { getPersona, getPersonas } from "../controllers/persona.controller.js";

export const personaRouter = Router();

personaRouter.get("/", getPersonas);
personaRouter.get("/:id", getPersona);

