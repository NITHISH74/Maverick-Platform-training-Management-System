import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function clean() {
  // Truncate in FK order to start fresh
  await c.query(`
    TRUNCATE TABLE
      audit_logs, notifications, feedback,
      topper_results, topper_config,
      assessment_scores, assessments,
      attendance, candidates,
      batch_trainers, batches,
      users
    RESTART IDENTITY CASCADE;
  `);
  console.log("Cleaned tables");
}

async function seed() {
  // 1. Users (including the real Auth0 test user)
  const users = [
    { auth0_sub: "auth0|nithishwar-placeholder", email: "nithishwarsenthilkumaran@gmail.com", full_name: "Nithishwar Senthilkumaran", role: "admin" },
    { auth0_sub: "auth0|coord-1", email: "priya.coordinator@maverick.com", full_name: "Priya Sharma", role: "coordinator" },
    { auth0_sub: "auth0|coord-2", email: "arun.coordinator@maverick.com", full_name: "Arun Kumar", role: "coordinator" },
    { auth0_sub: "auth0|trainer-1", email: "rahul.trainer@maverick.com", full_name: "Rahul Verma", role: "trainer" },
    { auth0_sub: "auth0|trainer-2", email: "anita.trainer@maverick.com", full_name: "Anita Reddy", role: "trainer" },
    { auth0_sub: "auth0|trainer-3", email: "vikram.trainer@maverick.com", full_name: "Vikram Singh", role: "trainer" },
  ];
  const userIds = {};
  for (const u of users) {
    const r = await c.query(
      `INSERT INTO users (auth0_sub, email, full_name, role, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [u.auth0_sub, u.email, u.full_name, u.role]
    );
    userIds[u.email] = r.rows[0].id;
  }
  console.log(`Inserted ${users.length} users`);

  const admin = userIds["nithishwarsenthilkumaran@gmail.com"];
  const coord1 = userIds["priya.coordinator@maverick.com"];
  const coord2 = userIds["arun.coordinator@maverick.com"];
  const trainer1 = userIds["rahul.trainer@maverick.com"];
  const trainer2 = userIds["anita.trainer@maverick.com"];
  const trainer3 = userIds["vikram.trainer@maverick.com"];

  // 2. Batches
  const batches = [
    { batch_code: "B-FSE-2025-A", name: "Full Stack Engineer Cohort A", program: "Full Stack Engineering", start_date: "2025-01-15", end_date: "2025-04-15", status: "completed", capacity: 30, coordinator_id: coord1 },
    { batch_code: "B-DSA-2025-B", name: "Data Science Cohort B", program: "Data Science", start_date: "2025-03-01", end_date: "2025-06-01", status: "completed", capacity: 25, coordinator_id: coord1 },
    { batch_code: "B-CLD-2025-C", name: "Cloud Engineering Cohort C", program: "Cloud Engineering", start_date: "2025-09-01", end_date: "2025-12-15", status: "running", capacity: 28, coordinator_id: coord2 },
    { batch_code: "B-FSE-2026-D", name: "Full Stack Engineer Cohort D", program: "Full Stack Engineering", start_date: "2026-01-10", end_date: "2026-04-10", status: "planned", capacity: 30, coordinator_id: coord1 },
  ];
  const batchIds = {};
  for (const b of batches) {
    const r = await c.query(
      `INSERT INTO batches (batch_code, name, program, start_date, end_date, status, capacity, coordinator_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.batch_code, b.name, b.program, b.start_date, b.end_date, b.status, b.capacity, b.coordinator_id]
    );
    batchIds[b.batch_code] = r.rows[0].id;
  }
  console.log(`Inserted ${batches.length} batches`);

  // 3. Batch trainers (assign trainers to batches)
  const bt = [
    [batchIds["B-FSE-2025-A"], trainer1],
    [batchIds["B-FSE-2025-A"], trainer2],
    [batchIds["B-DSA-2025-B"], trainer2],
    [batchIds["B-CLD-2025-C"], trainer3],
    [batchIds["B-CLD-2025-C"], trainer1],
    [batchIds["B-FSE-2026-D"], trainer1],
  ];
  for (const [bid, tid] of bt) {
    await c.query(`INSERT INTO batch_trainers (batch_id, trainer_id) VALUES ($1,$2)`, [bid, tid]);
  }
  console.log(`Assigned ${bt.length} trainers to batches`);

  // 4. Candidates — 6 per batch
  const firstNames = ["Aarav","Diya","Ishaan","Saanvi","Kabir","Anya","Vihaan","Aadhya","Reyansh","Pari","Arjun","Myra","Krish","Riya","Yuvan","Aanya","Dev","Ira","Atharva","Kiara","Vivaan","Anika","Shaurya","Navya"];
  const lastNames = ["Patel","Sharma","Mehta","Iyer","Reddy","Nair","Gupta","Khan","Das","Roy"];
  let cidx = 0;
  const candidateIds = [];
  for (const bcode of Object.keys(batchIds)) {
    if (bcode === "B-FSE-2026-D") continue; // planned batch — fewer candidates
    const bid = batchIds[bcode];
    for (let i = 0; i < 6; i++) {
      const fn = firstNames[cidx % firstNames.length];
      const ln = lastNames[cidx % lastNames.length];
      const status = bcode === "B-FSE-2025-A" ? (i < 4 ? "onboarded" : i === 4 ? "cleared" : "discontinued")
                  : bcode === "B-DSA-2025-B" ? (i < 5 ? "cleared" : "offered")
                  : "active";
      const r = await c.query(
        `INSERT INTO candidates (employee_id, full_name, email, phone, batch_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [`EMP${String(100 + cidx).padStart(4,"0")}`, `${fn} ${ln}`, `${fn.toLowerCase()}.${ln.toLowerCase()}@maverick.com`, `+9198${String(76543210 + cidx).slice(0,8)}`, bid, status]
      );
      candidateIds.push({ id: r.rows[0].id, batch_id: bid, name: `${fn} ${ln}`, batch_code: bcode });
      cidx++;
    }
  }
  // Add 3 to planned batch
  for (let i = 0; i < 3; i++) {
    const fn = firstNames[cidx % firstNames.length];
    const ln = lastNames[cidx % lastNames.length];
    const r = await c.query(
      `INSERT INTO candidates (employee_id, full_name, email, phone, batch_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [`EMP${String(100 + cidx).padStart(4,"0")}`, `${fn} ${ln}`, `${fn.toLowerCase()}.${ln.toLowerCase()}@maverick.com`, `+9198${String(76543210 + cidx).slice(0,8)}`, batchIds["B-FSE-2026-D"], "active"]
    );
    candidateIds.push({ id: r.rows[0].id, batch_id: batchIds["B-FSE-2026-D"], name: `${fn} ${ln}`, batch_code: "B-FSE-2026-D" });
    cidx++;
  }
  console.log(`Inserted ${candidateIds.length} candidates`);

  // 5. Attendance — last 10 working days for running batch (B-CLD-2025-C)
  const today = new Date();
  const attendanceStatuses = ["present","present","present","present","absent","leave","present","present","present","present"];
  let attCount = 0;
  for (const cand of candidateIds.filter(c => c.batch_code === "B-CLD-2025-C")) {
    for (let d = 0; d < 10; d++) {
      const day = new Date(today); day.setDate(day.getDate() - d - 1);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const status = attendanceStatuses[(cand.id + d) % attendanceStatuses.length];
      await c.query(
        `INSERT INTO attendance (candidate_id, batch_id, attend_date, status, marked_by, source) VALUES ($1,$2,$3,$4,$5,'manual')`,
        [cand.id, cand.batch_id, day.toISOString().slice(0,10), status, trainer3]
      );
      attCount++;
    }
  }
  console.log(`Inserted ${attCount} attendance records`);

  // 6. Assessments — 2 per candidate in completed batches
  const assessmentTypes = ["sprint","api","project"];
  let assCount = 0;
  for (const cand of candidateIds.filter(c => ["B-FSE-2025-A","B-DSA-2025-B","B-CLD-2025-C"].includes(c.batch_code))) {
    for (let i = 0; i < 3; i++) {
      const t = assessmentTypes[i];
      const score = 60 + ((cand.id * (i+1)) % 40);
      await c.query(
        `INSERT INTO assessments (candidate_id, batch_id, assessment_type, title, score, max_score, scheduled_date, uploaded_date, uploaded_by) VALUES ($1,$2,$3,$4,$5,100,$6,$6,$7)`,
        [cand.id, cand.batch_id, t, `${t.toUpperCase()} Assessment ${i+1}`, score, "2025-08-15", trainer1]
      );
      assCount++;
    }
  }
  console.log(`Inserted ${assCount} assessments`);

  // 7. Topper config (global)
  await c.query(`INSERT INTO topper_config (batch_id, attendance_weight, sprint_weight, api_weight, project_weight) VALUES (NULL, 20, 25, 25, 30)`);
  console.log("Inserted global topper config");

  // 8. Feedback
  const feedbackTexts = [
    "Excellent instruction and hands-on labs.",
    "The pace was a bit fast but the content was great.",
    "Loved the project-based learning approach.",
    "Trainer was very knowledgeable and supportive.",
    "Could use more time on advanced topics.",
  ];
  let fbCount = 0;
  for (const cand of candidateIds.filter(c => c.batch_code === "B-CLD-2025-C").slice(0, 4)) {
    await c.query(
      `INSERT INTO feedback (batch_id, candidate_id, trainer_id, response_text, rating) VALUES ($1,$2,$3,$4,$5)`,
      [cand.batch_id, cand.id, trainer3, feedbackTexts[fbCount % feedbackTexts.length], 3 + (fbCount % 3)]
    );
    fbCount++;
  }
  console.log(`Inserted ${fbCount} feedback rows`);

  // 9. Notifications for admin
  const notifs = [
    { title: "New batch starting", message: "Cohort D begins on Jan 10, 2026", type: "info" },
    { title: "Low attendance alert", message: "3 candidates in B-CLD-2025-C below 75%", type: "warning" },
    { title: "Assessment uploaded", message: "Sprint 2 scores published for B-CLD-2025-C", type: "success" },
  ];
  for (const n of notifs) {
    await c.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read) VALUES ($1,$2,$3,$4,false)`,
      [admin, n.title, n.message, n.type]
    );
  }
  console.log(`Inserted ${notifs.length} notifications`);

  // 10. Audit log entries
  const audits = [
    { action: "user.created", entity_type: "user", entity_id: coord1, details: "Coordinator account created" },
    { action: "batch.created", entity_type: "batch", entity_id: batchIds["B-CLD-2025-C"], details: "Cloud Engineering Cohort C" },
    { action: "candidates.imported", entity_type: "batch", entity_id: batchIds["B-CLD-2025-C"], details: "6 candidates imported via CSV" },
  ];
  for (const a of audits) {
    await c.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, details) VALUES ($1,$2,$3,$4,$5)`,
      [a.action, a.entity_type, a.entity_id, admin, a.details]
    );
  }
  console.log(`Inserted ${audits.length} audit log entries`);
}

try {
  await clean();
  await seed();
  console.log("\n✓ Seed completed successfully");
} catch (e) {
  console.error("✗ Seed failed:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
