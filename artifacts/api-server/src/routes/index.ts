import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import batchesRouter from "./batches";
import candidatesRouter from "./candidates";
import attendanceRouter from "./attendance";
import assessmentsRouter from "./assessments";
import toppersRouter from "./toppers";
import feedbackRouter from "./feedback";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import auditRouter from "./audit";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(batchesRouter);
router.use(candidatesRouter);
router.use(attendanceRouter);
router.use(assessmentsRouter);
router.use(toppersRouter);
router.use(feedbackRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(auditRouter);
router.use(reportsRouter);

export default router;
