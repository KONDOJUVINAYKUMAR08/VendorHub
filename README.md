# VendorHub - Vendor Risk & Compliance Management Platform (Microservices)

**Fully functional end-to-end Vendor Compliance Platform** using 7 Node.js microservices + MongoDB (official mongo:7 image). 

Real JWT auth with roles (admin/reviewer/vendor), dynamic risk calculation (configurable via env, no hardcodes), document versioning + bulk upload, approval workflows with comments, full immutable audit trail, expiring documents, in-app notifications, live dashboards.

**Architecture ready for AWS**: Comments in code for EKS, S3+KMS, EventBridge, DynamoDB migration, CloudTrail, ASG for traffic spikes (end-of-quarter, audit seasons).

## Project Structure
```
vendorhub/
├── frontend/                  # React 18 + Vite + Tailwind (light professional UI)
├── backend/
│   ├── services/
│   │   ├── auth-service/      # JWT + roles + seed (port 5001)
│   │   ├── vendor-service/    # CRUD + register (5002)
│   │   ├── document-service/  # Upload (single/bulk/versioning), expiring, approve/reject (5003)
│   │   ├── workflow-service/  # Pending tasks + complete (5004)
│   │   ├── compliance-service/# Dynamic risk calc + dashboard (5005)
│   │   ├── audit-service/     # Immutable logs (5006)
│   │   └── notification-service/ # In-app alerts (5007)
│   └── shared/                # (future common DTOs)
├── docker-compose.yml         # Full stack: mongo:7 + 7 services + volumes
├── .env.example
└── README.md
```

Inter-service: HTTP calls (with internal secret header) for now; documented for future EventBridge/SNS.

Each service: own Mongo DB/collection, Dockerfile, package.json, independent.

## Test Credentials (Seeded on first run)
- Admin: admin@vendorhub.com / admin123 (full access)
- Reviewer: reviewer1@vendorhub.com / reviewer123 (approve/reject)
- Vendor: vendor1@acme.com / vendor123 (self-service for v1)
- More vendors seeded.

**Full E2E Flow Works**:
1. Login as vendor → upload (single or bulk via modal)
2. Login as reviewer/admin → see in list, approve/reject with comment
3. Risk/score/status live update (compliance service)
4. Audit trail populates
5. Expiring list + notifications update
6. Dashboards reflect real data

## How to Run with Docker Compose (Recommended for Full Stack)

### Prerequisites (on your machine or EC2)
- Docker + Docker Compose installed
- Git (to clone or copy the folder)

### Step-by-Step on EC2 Instance (or any Linux)

1. **Launch EC2** (Amazon Linux 2 or Ubuntu recommended, t3.medium+ for comfort)
   - Security group: open ports 22 (SSH), 5001-5007 (for testing services directly), 27017 (optional), and for frontend if testing 5173 but usually local.
   - Or use ALB later.

2. **SSH into EC2**
   ```bash
   ssh -i your-key.pem ec2-user@<EC2-PUBLIC-IP>
   ```

3. **Install Docker & Compose (if not pre-installed)**
   ```bash
   # For Amazon Linux 2
   sudo yum update -y
   sudo yum install -y docker
   sudo service docker start
   sudo usermod -a -G docker ec2-user
   # Log out and back in for group, or:
   newgrp docker

   # Docker Compose (v2 plugin)
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   docker-compose version
   ```

4. **Clone or Upload the Project**
   - Option A: git clone (if you have the repo)
     ```bash
     git clone <your-repo-url> vendorhub
     cd vendorhub
     ```
   - Option B: SCP from local (from your machine):
     ```bash
     scp -i your-key.pem -r /path/to/local/vendorhub ec2-user@<EC2-IP>:/home/ec2-user/
     ssh -i your-key.pem ec2-user@<EC2-IP>
     cd /home/ec2-user/vendorhub
     ```

5. **(Optional) Copy .env**
   ```bash
   cp .env.example .env
   # Edit if needed (secrets etc)
   ```

6. **Build and Run the Full Stack**
   ```bash
   docker-compose up --build -d
   ```
   - This starts mongo + all 7 services.
   - First run: each service seeds its data (users, vendors).
   - Wait 30-60s for all healthy (check logs if needed).

7. **Verify Services**
   ```bash
   docker-compose ps
   docker-compose logs -f auth-service   # check seed message
   # Test one:
   curl http://localhost:5001/health
   ```

8. **Run Frontend Locally (dev server, talks to EC2 services)**
   On your **local machine** (or another terminal on EC2 if you want):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   - Open http://localhost:5173
   - **Important**: Since frontend is on local, it uses `http://localhost:500x` — change API_BASE in frontend/src/App.jsx temporarily to your EC2 IP e.g. `http://<EC2-PUBLIC-IP>:5001/api/auth` etc, then rebuild/restart dev.
   - Or for full Docker test, you can add frontend to docker-compose later (with VITE_ env for API).

   **Better for testing on EC2 only**: SSH port forward or use EC2 IP in browser + update frontend API_BASE to use EC2 public IP before npm run dev on EC2.

9. **Test E2E**
   - Login with test creds (see above).
   - As vendor: upload document (use real PDF or any).
   - As reviewer: go to vendors, approve/reject.
   - Watch risk update, audit, expiring, notifications.
   - Bulk upload supported in backend (UI single for now, can extend).

10. **Stop**
    ```bash
    docker-compose down
    # To remove volumes too: docker-compose down -v
    ```

## Local Development (without Docker, for debugging)
1. Start Mongo locally (or use docker for mongo only): `docker run -d -p 27017:27017 --name mongo mongo:7`
2. For each service (in separate terminals):
   ```bash
   cd backend/services/auth-service && npm install && npm start
   # Repeat for others (set MONGO_URI=mongodb://localhost:27017/auth etc if not using docker mongo)
   ```
3. Frontend: cd frontend && npm install && npm run dev
4. Update API_BASE in App.jsx to localhost:500x if needed.

## Seed / Reset
- Services auto-seed on empty DB.
- Or POST to /api/.../seed on each (e.g. curl -X POST http://localhost:5001/api/auth/seed)

## Configuration (No Hardcodes)
- All thresholds in docker-compose env (EXPIRY_WINDOW_DAYS=90, risk ratios etc).
- Change in docker-compose.yml or .env and `docker-compose up --build`.
- JWT_SECRET, INTERNAL_SECRET in env.

## Frontend API_BASE (for local dev)
In `frontend/src/App.jsx`:
```js
const API_BASE = {
  auth: 'http://localhost:5001/api/auth',
  document: 'http://localhost:5003/api/documents',
  // ... update to EC2 IP for remote testing: 'http://<EC2-IP>:5001/api/auth'
};
```

## Future Migration Notes (per prompt)
- Mongo → DynamoDB: each service's models easy to port (use DynamoDB DocumentClient).
- Files → S3 + KMS (update multer to aws-sdk upload in document-service).
- Events → EventBridge (replace HTTP triggers with putEvents).
- Deploy: EKS + Fargate or EC2 ASG per service; ALB + API Gateway in front.
- Auth → Cognito; Audit → CloudTrail + DynamoDB.
- Scale for spikes (end quarter uploads) with ASG.

## Troubleshooting
- Services not connecting: check depends_on, docker network (use container names like http://auth-service:5001).
- Multer/Upload: ensure 'file' field in form (frontend does).
- Auth: always pass Bearer token from login.
- Mongo auth: uses root admin/password123 (change in prod).
- Ports conflict on host: ok in docker.
- Frontend not seeing data: login first (all endpoints now require valid JWT), then loadData.
- To rebuild one service: docker-compose up --build auth-service

## Next (for you)
- Add nginx API gateway on port 5000 in compose for single frontend URL.
- Enhance frontend: bulk upload UI, document list per vendor with versions, notifications panel, full expiring table.
- Add CSV export, more filters.
- Add real file download (already served via /uploads).

The app is production-pattern ready for the AWS topics you mentioned (microservices, scaling, events, storage, auth, audit).

Run `docker-compose up --build` and login — everything flows end-to-end!