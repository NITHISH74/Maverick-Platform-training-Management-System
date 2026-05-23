# MAVERICK EXECUTION PLATFORM - BACKEND ARCHITECTURE SUMMARY

## Executive Overview

The Maverick Execution Platform is a **comprehensive Training Management System (TMS)** designed to manage the complete training lifecycle through intelligent automation, GenAI integration, and agentic AI workflows. This document provides a detailed analysis of the frontend architecture and defines the necessary backend architecture to support the platform's capabilities.

---

## 1. PLATFORM DEFINITION & OBJECTIVES

### 1.1 Core Purpose
A **centralized execution and governance platform** for training management that:
- Automates attendance, assessments, and feedback collection
- Provides real-time dashboards and analytics for training coordinators
- Enforces operational discipline through alerts and compliance monitoring
- Integrates AI/GenAI for predictive analytics and autonomous governance
- Supports 20,000+ users with <5 second dashboard load times

### 1.2 Key Business Drivers
- **Reduce manual effort by 90%** through automation and AI
- **Eliminate 10+ hours/week** of coordinator manual follow-ups
- **Improve training execution speed by 40%** with real-time workflows
- **Achieve 85% user satisfaction** within 3 months of deployment

### 1.3 Target Users & Roles
1. **Trainers** - Execute daily training, upload attendance/assessments
2. **Training Coordinators** - Manage batches, monitor execution, generate reports
3. **Admins** - System governance, user management, configuration
4. **Candidates** - Receive feedback, access training notifications

---

## 2. FRONTEND ARCHITECTURE ANALYSIS

### 2.1 Frontend Stack
```
Framework: React.js with TypeScript
Routing: Wouter (lightweight client-side routing)
State Management: TanStack React Query (@tanstack/react-query)
UI Components: Radix UI + shadcn/ui
Forms: React Hook Form + Zod validation
Styling: Tailwind CSS
Charts: Recharts
Build Tool: Vite
Deployment: Vercel (implied from tech stack)
```

### 2.2 Frontend Architecture Pattern
- **Monorepo Structure** - Multiple workspaces (maverick, api-server, shared libraries)
- **Component Library** - Full shadcn/ui component set (~50+ components)
- **API Client** - Auto-generated React Query hooks (`@workspace/api-client-react`)
- **Type-Safe Schemas** - Zod schemas generated from API spec (`@workspace/api-zod`)
- **Protected Routes** - Role-based route protection with `ProtectedRoute` component

### 2.3 Page/Feature Structure
```
Core Pages:
├── Login (Authentication)
├── Dashboard (Metrics & KPIs)
├── Batches (CRUD for training batches)
├── BatchDetail (Batch-level operations)
├── Candidates (Candidate management)
├── CandidateDetail (Individual candidate profile)
├── Attendance (Daily attendance tracking)
├── Assessments (Assessment management & scoring)
├── Toppers (Topper identification & reports)
├── Feedback (Feedback collection & analysis)
├── Notifications (Alert & notification center)
├── Reports (Export & download reports)
├── Users (User/role management - Admin only)
├── AuditLog (Compliance & audit trails)
├── Settings (System configuration)
└── NotFound (404 error page)
```

### 2.4 Authentication & Authorization
- **Token-Based Auth** - JWT or similar token mechanism
- **Auth Hook** - Custom `useAuth()` hook for session management
- **Token Storage** - LocalStorage with cross-tab synchronization
- **Role-Based Access Control (RBAC)**:
  - `admin` - Full system access
  - `coordinator` - Batch management, reports, audit
  - `trainer` - Attendance/assessment uploads only
- **Protected Routes** - Role-based route gating with fallback to 401 redirect

### 2.5 Data Fetching & Caching Strategy
- **TanStack React Query** - Server state management with:
  - Automatic caching
  - Background refetching
  - Pagination support
  - Error handling & retry logic
- **Auto-Generated API Client** - Hooks automatically generated from OpenAPI spec
  - Example: `useGetMe()`, `useListBatches()`, etc.
  - Includes query key generation for advanced cache management
- **Custom Fetch Layer** - Auth token injection via `setAuthTokenGetter()`

### 2.6 UI/UX Patterns
- **Responsive Design** - Mobile-first, Tailwind-based
- **Modular Components** - Reusable shadcn components
- **Data Tables** - Complex tables with sorting, filtering, pagination
- **Forms** - React Hook Form with Zod validation
- **Charts & Dashboards** - Recharts for analytics visualization
- **Toast Notifications** - Sonner for user feedback
- **Dialogs/Modals** - Radix UI-based modal dialogs

---

## 3. DATABASE SCHEMA ARCHITECTURE

### 3.1 Database System
- **Engine**: PostgreSQL (via Supabase)
- **ORM**: Drizzle ORM
- **Schema Definition**: TypeScript-first schema in `/lib/db`

### 3.2 Core Tables & Relationships

#### **Users Table**
```sql
users (RBAC Foundation)
├── id (PK)
├── email (unique)
├── name
├── passwordHash
├── role (admin | coordinator | trainer)
├── isActive
├── createdAt, updatedAt
```
**Purpose**: Authentication, authorization, user management

#### **Batches Table** (Training Batch Lifecycle)
```sql
batches
├── id (PK)
├── batchCode (unique) - e.g., "MERN_03"
├── name, program
├── startDate, endDate (YYYY-MM-DD)
├── status (planned | running | completed | closed)
├── capacity (default: 30)
├── coordinatorId (FK → users)
├── attendanceCutoffTime (default: "10:00")
├── createdAt, updatedAt

batch_trainers (Junction table)
├── id (PK)
├── batchId (FK)
├── trainerId (FK → users)
├── createdAt
```
**Purpose**: Training batch management, trainer assignments

#### **Candidates Table** (Learner Management)
```sql
candidates
├── id (PK)
├── candidateId (unique) - Excel import ID
├── name, email, phone
├── status (active | discontinued | cleared | not_cleared | offered | onboarded)
├── batchId (FK)
├── college, degree
├── joinedAt (YYYY-MM-DD)
├── createdAt, updatedAt
```
**Purpose**: Candidate master data, lifecycle tracking

#### **Attendance Table** (Daily Tracking)
```sql
attendance
├── id (PK)
├── candidateId (FK)
├── batchId (FK)
├── date (YYYY-MM-DD)
├── status (present | absent | leave | late)
├── remarks
├── submittedById (FK → users, trainer who submitted)
├── createdAt, updatedAt
```
**Purpose**: Daily attendance recording, versioned history

#### **Assessments Table** (Assessment Management)
```sql
assessments
├── id (PK)
├── batchId (FK)
├── title, type (sprint_review | coding | api | project_evaluation)
├── scheduledDate (YYYY-MM-DD)
├── maxScore (decimal, default: 100)
├── description
├── createdAt, updatedAt

assessment_scores
├── id (PK)
├── assessmentId (FK)
├── candidateId (FK)
├── score (decimal)
├── remarks
├── createdAt, updatedAt
```
**Purpose**: Assessment tracking, score management, score history

#### **Feedback Table** (Feedback Analytics)
```sql
feedback
├── id (PK)
├── batchId (FK)
├── candidateId (FK)
├── contentRating (integer)
├── trainerRating (integer)
├── overallRating (integer)
├── comments (text)
├── sentiment (positive | neutral | negative) ← AI-generated
├── createdAt
```
**Purpose**: Feedback collection, sentiment analysis, trend identification

#### **Toppers Table** (Ranking & Identification)
```sql
topper_config
├── id (PK)
├── assessmentWeight (60%)
├── projectWeight (30%)
├── attendanceWeight (10%)
├── updatedAt

topper_results
├── id (PK)
├── batchId (FK)
├── candidateId (FK)
├── rank
├── totalScore
├── assessmentScore, projectScore, attendanceScore
├── createdAt
```
**Purpose**: Configurable topper calculation, ranking results

#### **Notifications Table** (Alert & Notification Tracking)
```sql
notifications
├── id (PK)
├── userId (FK)
├── title, message
├── type (attendance_missing | continuous_absence | assessment_reminder | 
          feedback_reminder | upload_success | escalation | info)
├── isRead
├── relatedEntityType, relatedEntityId
├── createdAt
```
**Purpose**: Notification log, read status tracking, alert audit trail

#### **Audit Logs Table** (Compliance & Governance)
```sql
audit_logs
├── id (PK)
├── action (e.g., "batch_created", "attendance_uploaded")
├── entityType (batch | candidate | assessment | attendance | user)
├── entityId
├── actorId (FK → users, who performed the action)
├── details (JSON string with change details)
├── createdAt
```
**Purpose**: Full audit trail, compliance tracking, data change history

### 3.3 Data Relationships
```
users (1) ──→ (M) batches (as coordinator)
users (1) ──→ (M) batch_trainers
batch_trainers ←───→ batches

batches (1) ──→ (M) candidates
batches (1) ──→ (M) attendance
batches (1) ──→ (M) assessments
batches (1) ──→ (M) feedback
batches (1) ──→ (M) topper_results

candidates (1) ──→ (M) attendance
candidates (1) ──→ (M) assessment_scores
candidates (1) ──→ (M) feedback
candidates (1) ──→ (M) topper_results

assessments (1) ──→ (M) assessment_scores
users (1) ──→ (M) audit_logs
users (1) ──→ (M) notifications
```

---

## 4. BACKEND API ARCHITECTURE

### 4.1 Backend Stack
```
Framework: Express.js (Node.js)
Language: TypeScript
Database: PostgreSQL with Drizzle ORM
Logging: Pino (structured logging)
HTTP Client: Fetch/Node built-in
API Documentation: OpenAPI/Swagger (via Orval for codegen)
```

### 4.2 API Route Structure

```
/api/
├── /health                    # Health check endpoint
├── /auth                      # Authentication
│   ├── POST   /login          # Login & token generation
│   ├── POST   /logout         # Token invalidation
│   ├── GET    /me             # Current user profile
│   └── POST   /refresh        # Token refresh
├── /users                     # User management (Admin only)
│   ├── GET    /                 # List users
│   ├── POST   /                 # Create user
│   ├── GET    /:id              # Get user details
│   ├── PUT    /:id              # Update user
│   └── DELETE /:id              # Deactivate user
├── /batches                   # Batch management
│   ├── GET    /                 # List batches with filters
│   ├── POST   /                 # Create batch
│   ├── GET    /:id              # Get batch details
│   ├── PUT    /:id              # Update batch
│   ├── PATCH  /:id/status       # Update batch status
│   ├── POST   /:id/trainers     # Add trainer to batch
│   ├── DELETE /:id/trainers/:tid# Remove trainer
│   └── GET    /:id/candidates   # List batch candidates
├── /candidates                # Candidate management
│   ├── GET    /                 # List candidates
│   ├── POST   /                 # Create single candidate
│   ├── POST   /bulk-upload      # Excel bulk upload
│   ├── GET    /:id              # Get candidate details
│   ├── PUT    /:id              # Update candidate
│   └── PATCH  /:id/status       # Update candidate status
├── /attendance                # Daily attendance tracking
│   ├── GET    /                 # List attendance records
│   ├── POST   /                 # Create attendance entry
│   ├── POST   /bulk-upload      # Excel bulk upload
│   ├── GET    /:id              # Get attendance record
│   ├── PUT    /:id              # Update attendance
│   └── GET    /batch/:batchId   # Get batch attendance
├── /assessments               # Assessment management
│   ├── GET    /                 # List assessments
│   ├── POST   /                 # Create assessment
│   ├── GET    /:id              # Get assessment details
│   ├── PUT    /:id              # Update assessment
│   ├── POST   /:id/scores       # Upload assessment scores
│   ├── GET    /:id/scores       # Get assessment scores
│   └── POST   /:id/scores/bulk  # Excel bulk upload
├── /toppers                   # Topper identification
│   ├── GET    /config           # Get topper config
│   ├── PUT    /config           # Update topper config (Admin)
│   ├── POST   /calculate        # Calculate toppers for batch
│   ├── GET    /batch/:batchId   # Get batch toppers
│   └── GET    /overall          # Get overall toppers
├── /feedback                  # Feedback management
│   ├── GET    /                 # List feedback
│   ├── POST   /                 # Submit feedback
│   ├── GET    /:id              # Get feedback details
│   ├── POST   /trigger-email    # Trigger feedback emails
│   ├── GET    /batch/:batchId   # Get batch feedback
│   └── POST   /analyze          # AI sentiment analysis
├── /notifications             # Notification management
│   ├── GET    /                 # Get user notifications
│   ├── PATCH  /:id/read         # Mark as read
│   ├── DELETE /:id              # Delete notification
│   └── POST   /send-email       # Email notification dispatch
├── /dashboard                 # Analytics & metrics
│   ├── GET    /summary          # Dashboard KPIs
│   ├── GET    /batch-analytics  # Batch-level metrics
│   ├── GET    /trainer-analytics# Trainer performance
│   └── GET    /attendance-trends# Attendance analytics
├── /reports                   # Report generation
│   ├── GET    /attendance       # Attendance report (Excel/PDF)
│   ├── GET    /assessment       # Assessment report
│   ├── GET    /toppers          # Topper report
│   ├── GET    /consolidated     # Consolidated batch report
│   ├── GET    /feedback         # Feedback report
│   └── GET    /export/:type     # Generic export endpoint
├── /audit                     # Audit & compliance
│   ├── GET    /logs             # Get audit logs with filters
│   ├── GET    /logs/:id         # Get specific log entry
│   └── GET    /export           # Export audit trail (Compliance)
└── /ai                        # AI/GenAI integration (Future)
    ├── POST   /feedback-analysis   # Sentiment analysis
    ├── POST   /notifications       # AI-generated messages
    ├── POST   /batch-monitoring    # Agentic monitoring
    └── POST   /dashboard-chat      # Natural language queries
```

### 4.3 Authentication & Authorization Architecture

#### **JWT Token Structure**
```json
{
  "userId": 123,
  "email": "coordinator@example.com",
  "role": "coordinator",
  "iat": 1234567890,
  "exp": 1234571490
}
```

#### **Authorization Strategy**
- **Route-Level RBAC**: `requireRole('admin', 'coordinator')`
- **Data-Level RBAC**: 
  - Trainers can only access assigned batch data
  - Coordinators can only access their batch data
  - Admins have full access
- **Field-Level Security**: Sensitive fields redacted based on role

### 4.4 Middleware Stack
```typescript
app.use(cors())                    // CORS handling
app.use(express.json())            // JSON parsing
app.use(pinoHttp(...))             // Request logging
app.use(authMiddleware)            // JWT validation
app.use(errorHandler)              // Error response formatting
app.use(auditLogger)               // Audit trail logging
```

---

## 5. CORE BUSINESS LOGIC MODULES

### 5.1 Attendance Module
**Responsibilities:**
- Daily attendance recording (manual entry & Excel upload)
- Attendance validation & deduplication
- 10:00 AM cut-off enforcement
- Missing attendance alerts
- Continuous absence detection (3+ days)
- Attendance percentage calculation

**Key Operations:**
- `recordAttendance(candidateId, date, status)` 
- `validateAndUploadExcel(file, batchId)`
- `checkMissingAttendance(batchId, currentTime)`
- `detectContinuousAbsence(candidateId, threshold=3)`
- `calculateAttendancePercentage(batchId, dateRange)`

### 5.2 Assessment Module
**Responsibilities:**
- Assessment creation & scheduling
- Assessment score upload & validation
- Score range validation
- Duplicate detection
- Score mapping to candidates
- Multiple assessment type handling (sprint review, coding, API, project eval)

**Key Operations:**
- `createAssessment(batchId, title, type, date, maxScore)`
- `uploadAssessmentScores(assessmentId, excelFile)`
- `validateScores(scores, maxScore)`
- `getAssessmentScores(assessmentId, candidateId)`
- `calculateClearanceRate(batchId, assessmentType)`

### 5.3 Topper Identification Module
**Responsibilities:**
- Configurable topper criteria
- Weighted score calculation
- Rank assignment
- Transparent & auditable logic
- Real-time ranking updates

**Weightage Configuration:**
```
Total Score = (Assessment Score × 60%) + (Project Score × 30%) + (Attendance × 10%)
```

**Key Operations:**
- `getTopperConfig()`
- `updateTopperConfig(weights)` [Admin only]
- `calculateToppers(batchId)` [Triggers ranking calculation]
- `getToppersByBatch(batchId)`
- `getOverallToppers()` [Across all batches]

### 5.4 Feedback Module
**Responsibilities:**
- Feedback collection window management
- Feedback form distribution via email
- Response storage & versioning
- Batch-wise aggregation
- AI sentiment analysis (GenAI)
- Trend identification

**Key Operations:**
- `triggerFeedbackEmails(batchId)`
- `submitFeedback(candidateId, batchId, ratings, comments)`
- `getFeedbackByBatch(batchId)`
- `analyzeSentiment(comments)` [GenAI integration]
- `generateFeedbackReport(batchId)` [Insights & trends]

### 5.5 Notification & Alert Module
**Responsibilities:**
- Event-driven notification triggering
- Multi-channel delivery (Email as primary)
- Notification logging & audit trail
- Alert escalation rules
- Template management
- GenAI-powered personalized messages

**Trigger Events:**
- Attendance not submitted by 10:00 AM
- Continuous absence (3+ days)
- Assessment score upload success
- Upcoming assessment date
- Feedback window opened
- Escalation alerts

**Key Operations:**
- `triggerNotification(type, recipients, context)`
- `sendEmailNotification(userId, template, data)`
- `generatePersonalizedMessage(template, context)` [GenAI]
- `getNotifications(userId, filters)`
- `markAsRead(notificationId)`

### 5.6 Batch Management Module
**Responsibilities:**
- Batch lifecycle management (planned → running → completed → closed)
- Status transition validation
- Trainer assignment management
- Candidate bulk upload & mapping
- Assessment schedule setup
- Batch-wide operations

**Key Operations:**
- `createBatch(name, program, dates, capacity)`
- `updateBatchStatus(batchId, newStatus)` [Validates transitions]
- `addTrainer(batchId, trainerId)`
- `uploadCandidates(batchId, excelFile)` [Bulk mapping]
- `getBatchDetails(batchId)` [Include candidates, trainers, schedule]
- `closeBatch(batchId)` [Freeze & archive]

### 5.7 Audit & Compliance Module
**Responsibilities:**
- Log all data changes
- Track user actions
- Maintain audit trail
- Compliance reporting
- Data integrity verification

**Auditable Actions:**
- User creation/modification
- Batch status changes
- Attendance uploads/modifications
- Assessment uploads/modifications
- Topper calculations
- Configuration changes

**Key Operations:**
- `logAudit(action, entityType, entityId, actorId, details)`
- `getAuditLog(filters)`
- `exportAuditTrail(format)` [Excel/PDF]

### 5.8 Dashboard & Analytics Module
**Responsibilities:**
- Real-time metrics aggregation
- Dashboard KPI calculation
- Batch-level analytics
- Trainer performance metrics
- Attendance trend analysis
- Assessment clearance rates

**Key Metrics:**
- Total candidates in batch
- Discontinued candidates
- Not-cleared candidates
- Offered/onboarded candidates
- Attendance percentage
- Assessment clearance rate
- Trainer-wise performance
- Batch-wise comparison

**Key Operations:**
- `getDashboardSummary(userId)` [Role-specific]
- `getBatchAnalytics(batchId, dateRange)`
- `getTrainerAnalytics(trainerId, dateRange)`
- `getAttendanceTrends(batchId, dateRange)`

---

## 6. INTEGRATION REQUIREMENTS

### 6.1 File Upload & Processing
- **Excel Upload Handler**
  - Supported formats: `.xlsx`, `.xls`
  - Max file size: 20,000 records
  - Validation: Schema validation, duplicate checks, data type validation
  - Error reporting: Line-by-line error feedback
  - Async processing: Large file handling via background jobs

**File Templates:**
- Candidate master data (candidateId, name, email, phone, college, degree)
- Attendance (candidateId, date, status, remarks)
- Assessment scores (candidateId, score, remarks)

### 6.2 Email Notification System
- **SMTP Configuration** (Required)
- **Template Engine** - For dynamic content
- **Batch Processing** - Send notifications in batches (1000+/hour)
- **Retry Logic** - Exponential backoff for failed sends
- **Tracking** - Email delivery status in notifications table

**Email Templates:**
- Attendance missing alert
- Continuous absence escalation
- Feedback request
- Assessment reminder
- Topper announcement
- Custom notifications (GenAI-generated)

### 6.3 GenAI Integration Points
1. **Feedback Sentiment Analysis** (Gemini 2.5 Flash / LLAMA)
   - Input: Feedback text
   - Output: Sentiment (positive/neutral/negative) + key insights
   - Cache: Store sentiment in feedback table

2. **AI Notification Generation** (GenAI)
   - Input: Template, context data
   - Output: Personalized message with tone variation
   - Use: Escalation messages, custom alerts

3. **Agentic AI Batch Monitoring** (CrewAI/Crew Framework)
   - Input: Batch metrics, thresholds
   - Output: Autonomous alerts, recommendations
   - Agents: Attendance Monitor, Assessment Monitor, Performance Monitor

4. **Dashboard Chatbot** (RAG + SQL Gen)
   - Input: Natural language query
   - Output: SQL query → Dashboard insight
   - Example: "Show batches with low attendance" → Auto-generate query

### 6.4 Report Generation
- **Export Formats**: Excel, PDF
- **Report Types**:
  - Batch attendance report
  - Assessment score report
  - Topper list (by batch & overall)
  - Consolidated batch report (with filters)
  - Feedback summary report
  - Audit trail export
- **Filtering**: By batch, date range, candidate status, trainer

### 6.5 Excel-to-Database Mapping
```typescript
// Example: Bulk candidate upload
Excel → Validation → Parse → Map to candidatesTable → Bulk Insert → Audit Log

// Example: Attendance bulk upload
Excel → Validate (candidate exists, batch active) → Parse → 
Deduplicate → Insert → Notify → Audit Log
```

---

## 7. NON-FUNCTIONAL REQUIREMENTS

### 7.1 Performance
- **Dashboard load time**: < 5 seconds
- **API response time**: < 1 second for standard queries
- **Bulk upload support**: 20,000 records
- **Concurrent users**: Support 100+ simultaneous users
- **Caching**: Redis for session & hot data (future)

### 7.2 Scalability
- **Horizontal scaling**: Stateless API servers
- **Database optimization**: Proper indexing, query optimization
- **Load balancing**: API behind load balancer
- **Connection pooling**: Database connection pooling (Drizzle + PgBouncer)
- **CDN**: Static assets on CDN (images, JS bundles)

### 7.3 Security
- **Password hashing**: bcrypt with salt rounds ≥ 12
- **JWT signing**: Secure secret key
- **HTTPS only**: All API calls over TLS 1.2+
- **CORS**: Configured for frontend domain only
- **SQL Injection prevention**: Parameterized queries (Drizzle ORM)
- **Rate limiting**: API endpoint rate limiting
- **Data encryption**: At-rest encryption for sensitive fields (future)
- **Access control**: RBAC with data-level filtering

### 7.4 Availability & Disaster Recovery
- **Uptime SLA**: 99.5%
- **Database backups**: Daily automated backups
- **Connection retry**: Exponential backoff
- **Error handling**: Graceful degradation
- **Logging**: Structured logging for debugging

### 7.5 Audit & Compliance
- **Audit logging**: All data changes logged
- **Immutable audit trail**: Append-only audit log
- **GDPR readiness**: Data deletion on request
- **Data retention**: Configurable retention policies
- **Compliance reports**: Exportable audit trails

---

## 8. REQUIRED BACKEND ENDPOINTS SUMMARY

### **Authentication (Public)**
- `POST /auth/login` - Login
- `GET /auth/me` - Get current user

### **User Management (Admin only)**
- `GET /users` - List users
- `POST /users` - Create user
- `GET /users/:id` - Get user
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Deactivate user

### **Batch Management (Coordinator+)**
- `GET /batches` - List batches
- `POST /batches` - Create batch
- `GET /batches/:id` - Get batch
- `PUT /batches/:id` - Update batch
- `PATCH /batches/:id/status` - Update status
- `POST /batches/:id/trainers` - Add trainer
- `DELETE /batches/:id/trainers/:tid` - Remove trainer

### **Candidate Management**
- `GET /candidates` - List candidates
- `POST /candidates` - Create candidate
- `POST /candidates/bulk-upload` - Excel upload
- `GET /candidates/:id` - Get candidate
- `PUT /candidates/:id` - Update candidate
- `PATCH /candidates/:id/status` - Update status

### **Attendance**
- `GET /attendance` - List attendance
- `POST /attendance` - Record attendance
- `POST /attendance/bulk-upload` - Excel upload
- `GET /attendance/:id` - Get record
- `PUT /attendance/:id` - Update record
- `GET /attendance/batch/:batchId` - Batch attendance

### **Assessments**
- `GET /assessments` - List assessments
- `POST /assessments` - Create assessment
- `GET /assessments/:id` - Get assessment
- `PUT /assessments/:id` - Update assessment
- `POST /assessments/:id/scores` - Record score
- `POST /assessments/:id/scores/bulk` - Excel upload
- `GET /assessments/:id/scores` - Get scores

### **Toppers**
- `GET /toppers/config` - Get topper config
- `PUT /toppers/config` - Update config (Admin)
- `POST /toppers/calculate` - Calculate toppers
- `GET /toppers/batch/:batchId` - Get batch toppers
- `GET /toppers/overall` - Get overall toppers

### **Feedback**
- `GET /feedback` - List feedback
- `POST /feedback` - Submit feedback
- `GET /feedback/:id` - Get feedback
- `POST /feedback/trigger-email` - Send feedback emails
- `GET /feedback/batch/:batchId` - Get batch feedback
- `POST /feedback/analyze` - AI sentiment analysis

### **Notifications**
- `GET /notifications` - Get notifications
- `PATCH /notifications/:id/read` - Mark read
- `DELETE /notifications/:id` - Delete notification
- `POST /notifications/send-email` - Send email

### **Dashboard**
- `GET /dashboard/summary` - KPIs
- `GET /dashboard/batch-analytics/:batchId` - Batch metrics
- `GET /dashboard/trainer-analytics/:trainerId` - Trainer metrics
- `GET /dashboard/attendance-trends/:batchId` - Trends

### **Reports**
- `GET /reports/attendance` - Attendance report
- `GET /reports/assessment` - Assessment report
- `GET /reports/toppers` - Topper report
- `GET /reports/consolidated` - Consolidated report
- `GET /reports/feedback` - Feedback report
- `GET /reports/export/:type` - Generic export

### **Audit**
- `GET /audit/logs` - Get audit logs
- `GET /audit/logs/:id` - Get specific log
- `GET /audit/export` - Export audit trail

---

## 9. DATA FLOW ARCHITECTURE

### 9.1 Attendance Submission Flow
```
Trainer Portal
     ↓
Manual Entry / Excel Upload
     ↓
POST /attendance (or /attendance/bulk-upload)
     ↓
API Validation (duplicates, candidate exists, batch running)
     ↓
Insert into attendanceTable
     ↓
Log Audit (INSERT audit_logs)
     ↓
Check for missing submissions or absences
     ↓
IF missing → Trigger attendance_missing notification → Send Email
IF 3+ consecutive absences → Trigger continuous_absence alert → Send Email
     ↓
Update dashboard metrics (cached)
```

### 9.2 Assessment Score Flow
```
Trainer Portal
     ↓
Excel File Upload (assessment_scores.xlsx)
     ↓
POST /assessments/:id/scores/bulk
     ↓
Validate (candidate exists, score in range, no duplicates)
     ↓
Batch Insert into assessment_scoresTable
     ↓
Log Audit (INSERT audit_logs)
     ↓
Trigger assessment_upload_success notification
     ↓
Calculate topper scores (if batch complete)
     ↓
Update dashboard clearance rates
```

### 9.3 Feedback Analysis Flow
```
Candidate Submits Feedback
     ↓
POST /feedback (submit ratings + comments)
     ↓
Insert into feedbackTable
     ↓
Log Audit (INSERT audit_logs)
     ↓
IF comments exist:
   → Send to GenAI sentiment analysis (Gemini 2.5 Flash)
   → Update feedback.sentiment (positive | neutral | negative)
     ↓
Aggregate feedback data for batch
     ↓
Generate insights (common complaints, improvements, etc.)
     ↓
Coordinator downloads feedback report
```

### 9.4 Topper Calculation Flow
```
Admin / Coordinator triggers calculation
     ↓
POST /toppers/calculate
     ↓
Get topper_config (assessment 60%, project 30%, attendance 10%)
     ↓
For each candidate in batch:
   → Calculate assessment_score (avg of all assessments)
   → Calculate project_score (project evaluation score)
   → Calculate attendance_score (attendance % normalized to 100)
   → total_score = (assessment × 0.6) + (project × 0.3) + (attendance × 0.1)
     ↓
Sort by total_score descending
     ↓
Assign ranks (1, 2, 3, ...)
     ↓
Insert into topper_resultsTable
     ↓
Log Audit (INSERT audit_logs)
     ↓
Update toppers dashboard
     ↓
Trigger topper_announcement notifications (optional)
```

### 9.5 Dashboard Data Flow
```
Frontend: GET /dashboard/summary (coordinator)
     ↓
API Calculation (in-memory cache or Redis):
   → Count total candidates in batch
   → Count discontinued candidates
   → Count not-cleared candidates
   → Count offered/onboarded candidates
   → Calculate attendance percentage
   → Calculate assessment clearance rate
   → Trainer performance metrics
     ↓
Return aggregated KPIs (< 1 second)
     ↓
Frontend renders charts (Recharts)
```

---

## 10. AI/GENAI INTEGRATION ARCHITECTURE

### 10.1 Sentiment Analysis Pipeline
```
Feedback Submission
     ↓
Extract comments text
     ↓
Call GenAI (Gemini 2.5 Flash / LLAMA via Hugging Face)
     ↓
Prompt: "Analyze the sentiment of this feedback. Response: positive/neutral/negative + key insights"
     ↓
Store sentiment in feedbackTable.sentiment
     ↓
Aggregate for batch-level insights
```

### 10.2 Agentic AI Batch Monitoring
```
Scheduled Job (every 6 hours)
     ↓
CrewAI Agents:
   1. Attendance Monitor Agent
      → Check for missing submissions
      → Detect continuous absences
      → Calculate attendance trends
   
   2. Assessment Monitor Agent
      → Check for delayed uploads
      → Monitor score distributions
      → Flag low performers
   
   3. Performance Monitor Agent
      → Identify at-risk candidates
      → Track batch progression
      → Suggest interventions
     ↓
Agents generate autonomous alerts
     ↓
Create notifications in notificationsTable
     ↓
Send email escalations to coordinators
```

### 10.3 AI-Generated Notifications
```
Trigger Event (attendance missing, assessment delayed, etc.)
     ↓
Retrieve context (candidate name, trainer, deadline, etc.)
     ↓
Call GenAI with prompt:
   "Generate a professional notification message for: [context]
    Tone: formal | friendly | escalation"
     ↓
GenAI returns personalized message
     ↓
Insert into notificationsTable with generated message
     ↓
Send via email
```

### 10.4 Dashboard Chatbot
```
User: "Show batches with attendance < 70%"
     ↓
Natural Language Query → LLM (Claude Opus 4.7 / Gemini)
     ↓
LLM generates SQL:
   SELECT b.*, AVG(a.status = 'present') as attendance_pct
   FROM batches b
   LEFT JOIN attendance a ON b.id = a.batch_id
   GROUP BY b.id
   HAVING AVG(a.status = 'present') < 0.7
     ↓
Execute SQL → Fetch results
     ↓
Format for frontend → Display dashboard insight
```

---

## 11. DEPLOYMENT & INFRASTRUCTURE

### 11.1 Recommended Deployment Architecture
```
Frontend:
  - Vercel (Next.js/React deployment)
  - CDN for static assets
  - Automatic SSL/TLS

Backend API:
  - Node.js Express server (containerized)
  - Docker / Container orchestration
  - Platform options: Vercel Functions, Railway, Render, or AWS ECS
  - Environment: Production, Staging, Development

Database:
  - PostgreSQL (Supabase recommended for managed service)
  - Connection pooling (PgBouncer)
  - Automated backups
  - Read replicas for analytics (future)

Caching (Future):
  - Redis for session store
  - Redis for hot data cache
  - Option: Upstash (serverless Redis)

Job Queue (Future):
  - Bull Queue / RabbitMQ for async jobs
  - Processes: Email sending, bulk uploads, topper calculations

AI Services:
  - Google Gemini 2.5 Flash API
  - Hugging Face APIs (for LLAMA fine-tuning)
  - Azure AI Foundry (for multi-model orchestration)
```

### 11.2 Environment Variables Required
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# Auth
JWT_SECRET=<random-secure-key>
JWT_EXPIRY=3600

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=<password>
EMAIL_FROM=Maverick <noreply@example.com>

# GenAI
GOOGLE_AI_API_KEY=<gemini-api-key>
HUGGING_FACE_API_KEY=<huggingface-key>
AZURE_AI_KEY=<azure-key>

# Frontend
REACT_APP_API_URL=https://api.example.com

# Logging
LOG_LEVEL=info
SENTRY_DSN=<sentry-dsn> (error tracking)

# Security
CORS_ORIGIN=https://frontend.example.com
NODE_ENV=production
```

---

## 12. IMPLEMENTATION ROADMAP

### **Phase 1: Core Infrastructure** (Weeks 1-2)
- [ ] Backend API scaffolding (Express + Drizzle)
- [ ] PostgreSQL schema implementation
- [ ] JWT authentication system
- [ ] User & role management endpoints
- [ ] CORS & middleware setup

### **Phase 2: Batch & Candidate Management** (Weeks 2-3)
- [ ] Batch CRUD & lifecycle endpoints
- [ ] Candidate bulk upload & mapping
- [ ] Trainer assignment system
- [ ] Batch detail & analytics endpoints

### **Phase 3: Attendance & Tracking** (Weeks 3-4)
- [ ] Attendance recording endpoints
- [ ] Excel upload validation & processing
- [ ] 10:00 AM cut-off enforcement
- [ ] Missing & continuous absence alerts
- [ ] Attendance dashboard metrics

### **Phase 4: Assessment Management** (Week 4)
- [ ] Assessment creation & scheduling
- [ ] Score upload & validation
- [ ] Score mapping to candidates
- [ ] Clearance rate calculation

### **Phase 5: Topper Identification** (Week 5)
- [ ] Topper config management
- [ ] Scoring & ranking algorithm
- [ ] Transparent audit trail for rankings
- [ ] Topper report generation

### **Phase 6: Feedback & Notifications** (Week 5)
- [ ] Feedback submission & storage
- [ ] Notification system setup
- [ ] Email template engine
- [ ] Alert escalation rules

### **Phase 7: Reports & Dashboard** (Weeks 6-7)
- [ ] Dashboard analytics aggregation
- [ ] Report generation (Excel/PDF)
- [ ] Filtering & export endpoints
- [ ] Audit log export

### **Phase 8: GenAI Integration** (Weeks 7-8)
- [ ] Sentiment analysis integration
- [ ] AI notification generation
- [ ] Agentic monitoring setup
- [ ] Dashboard chatbot (if time permits)

### **Phase 9: Testing & Optimization** (Weeks 8+)
- [ ] Load testing (20,000 records)
- [ ] Security audit
- [ ] Performance optimization
- [ ] Documentation & training

---

## 13. KEY TECHNICAL DECISIONS

### 13.1 Framework Choices Rationale
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Frontend | React + Wouter | Lightweight, fast, suitable for TMS complexity |
| API | Express.js | Lightweight, Node ecosystem, mature middleware |
| Database | PostgreSQL | ACID compliance, relational data fits TMS perfectly |
| ORM | Drizzle | Type-safe, minimal overhead, excellent TypeScript support |
| Validation | Zod | Runtime validation, schema generation, React Query integration |
| UI Components | shadcn/ui | Unstyled, accessible, fully customizable with Tailwind |
| State Management | React Query | Perfect for server state sync, caching, mutations |
| Logging | Pino | Structured JSON logging, excellent performance |

### 13.2 Architectural Patterns
- **Monorepo**: Shared types, libraries, schema across frontend/backend
- **API-First Design**: OpenAPI spec generation for auto-generated clients
- **RBAC at Route & Data Level**: Dual-layer authorization
- **Event-Driven Notifications**: Decoupled alert system
- **Audit-First**: All changes logged immediately
- **Cache-Friendly**: Proper HTTP caching headers, React Query optimization

---

## 14. SUMMARY OF BACKEND REQUIREMENTS

### Core Modules
1. **Authentication Module** - JWT-based auth with role support
2. **Batch Management Module** - Full lifecycle + trainer assignments
3. **Candidate Management Module** - Bulk import + status tracking
4. **Attendance Module** - Daily recording + alerts + analytics
5. **Assessment Module** - Score management + clearance tracking
6. **Topper Module** - Configurable ranking + transparent calculation
7. **Feedback Module** - Collection + AI sentiment analysis
8. **Notification Module** - Event-driven + email dispatch
9. **Dashboard Module** - Real-time metrics + analytics
10. **Report Module** - Excel/PDF generation + filtering
11. **Audit Module** - Compliance logging + export
12. **AI Integration Module** - GenAI/Agentic AI workflows

### Critical Success Factors
- **Sub-second API responses** for dashboard load
- **Accurate Excel processing** with clear error feedback
- **Reliable email delivery** with retry logic
- **Transparent topper calculations** with full audit trail
- **Scalable to 20,000+ users** without performance degradation
- **GenAI integration** for sentiment & automation
- **Role-based data isolation** for security

---

## 15. NEXT STEPS

1. **Create Backend API Project** - Express + TypeScript skeleton
2. **Implement Database Schema** - All 11 tables with migrations
3. **Build Auth System** - JWT + RBAC + middleware
4. **Create Route Handlers** - All 14 route modules
5. **Add Business Logic** - Core computation functions
6. **Implement Email System** - SMTP + templates
7. **Integrate GenAI APIs** - Sentiment analysis & agents
8. **Add Comprehensive Testing** - Unit + integration tests
9. **Performance Optimization** - Indexing, caching, query optimization
10. **Deploy & Monitor** - CI/CD pipeline, error tracking, logging

---

**Document Version**: 1.0  
**Last Updated**: May 23, 2026  
**Status**: Ready for Backend Development  
