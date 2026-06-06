# VendorHub - Real Vendor Risk & Compliance Management Platform

This is now a **real application** that solves the actual business problem of vendor risk and compliance management.

## How to Run the Full Application

### 1. Start the Backend (Real Business Logic)
```bash
cd backend
node server.js
```

The backend runs on **http://localhost:5000**

It provides:
- Real persistence (vendors, documents, audit logs saved to JSON files)
- Real document upload (files saved to disk, simulating S3)
- Real approval workflow (status changes, risk recalculation)
- Full audit trail for every action
- Automatic compliance status and risk scoring based on actual documents

### 2. Start the Frontend
In another terminal:
```bash
cd vendorhub
npm run dev
```

Open http://localhost:5173

## What This Application Actually Does (Solves the Real Problem)

**Core Business Value:**
- **Vendor Self-Service Portal**: Vendors can register and upload their own compliance documents (contracts, SOC2, ISO certs, insurance, audit reports) without email chaos.
- **Internal Compliance Dashboard**: Security, Legal, and Procurement teams get a single source of truth with risk scores, expiring documents, and approval workflows.
- **Real Workflow Enforcement**: Documents go through proper review (approve/reject). Status and risk scores update automatically.
- **Complete Audit Trail**: Every upload, approval, and change is logged with timestamp and user (maps directly to CloudTrail in production).
- **Expiry & Risk Management**: System automatically flags expiring documents and calculates vendor risk based on document completeness and validity.

**Why This Solves the Real Problem:**
Before: Spreadsheets + endless emails → missed expirations, audit failures, high risk vendors slipping through.
After: Centralized, auditable, self-service system with real-time risk visibility and enforced processes.

## Current State (Solves the Problem Today)

- Uploads actually save files and metadata
- Approvals change real document status and recalculate vendor risk
- Dashboard, vendors list, and audit log are 100% driven by real backend data
- Role switcher lets you experience both Internal Team and Vendor Portal
- Beautiful light professional UI (no dark theme)

## Next Steps for Full AWS Alignment

1. Backend will be deployed to EC2 behind ASG + ALB
2. File uploads will go to real S3 with KMS encryption
3. Audit logs will be written to CloudTrail + DynamoDB
4. Add real auth (Cognito)
5. Add API Gateway for external integrations
6. Add EventBridge/Lambda for automated notifications on expiries

## How to Use

1. Start backend
2. Start frontend
3. Switch to "Vendor Portal" role → upload documents for a vendor
4. Switch to "Internal Team" → approve documents, watch risk/score update live
5. Check the Audit Trail tab — it's real and growing

This is the foundation of an application that genuinely requires and benefits from the full AWS stack you want to learn.