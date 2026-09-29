import { Router } from "express";
import authRoutes from "./auth.js";
import moduleRoutes from "./modules.js";
import questionRoutes from "./questions.js";
import assessmentRoutes from "./assessments.js";
import actionRoutes from "./actions.js";
import evidenceRoutes from "./evidence.js";
import listRoutes from "./lists.js";
import userRoutes from "./users.js";
import departmentRoutes from "./departments.js";
import dashboardRoutes from "./dashboard.js";
import dashboardManagementRoutes from "./dashboardManagement.js";
import auditorRoutes from "./auditors.js";
import superadminRoutes from "./superadmin.js";
import settingsRoutes from "./settings.js";
import reminderRoutes from "./reminders.js";
import dpdpaRoutes from "./dpdpa.js";
import contactRoutes from "./contact.js";
import consentRoutes from "./consent.js";
import vaultRoutes from "./vault.js";
import requestRoutes from "./requests.js";
import notificationRoutes from "./notifications.js";
import marketplaceRoutes from "./marketplace.js";
import selfAssessmentRoutes from "./selfAssessment.js";
import integrationRoutes from "./integrations.js";
import findingRoutes from "./findings.js";
import frameworkRoutes from "./frameworks.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/departments", departmentRoutes);
router.use("/modules", moduleRoutes);
router.use("/questions", questionRoutes);
router.use("/assessments", assessmentRoutes);
router.use("/actions", actionRoutes);
router.use("/evidence", evidenceRoutes);
router.use("/lists", listRoutes);
router.use("/dashboard/management", dashboardManagementRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/auditors", auditorRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/settings", settingsRoutes);
router.use("/reminders", reminderRoutes);
router.use("/dpdpa", dpdpaRoutes);
router.use("/contact", contactRoutes);
router.use("/consent", consentRoutes);
router.use("/vault", vaultRoutes);
router.use("/requests", requestRoutes);
router.use("/notifications", notificationRoutes);
router.use("/marketplace", marketplaceRoutes);
router.use("/self-assessment", selfAssessmentRoutes);
router.use("/integrations", integrationRoutes);
router.use("/findings", findingRoutes);
router.use("/frameworks", frameworkRoutes);

// Alias /api/prefs/version for the consent version endpoint — avoids ad-blocker filter lists
// that block URLs matching "consent" or "cookie"
router.get("/prefs/version", (req, res) => {
  res.json({ version: "1.0" });
});

export { router };
