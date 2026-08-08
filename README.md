# ⚡ Real-Time RTO Analysis & Risk Predictor — Shopify Application

[![Shopify App](https://img.shields.io/badge/Shopify-Embedded%20App-95BF47.svg?style=for-the-badge&logo=shopify&logoColor=white)](https://shopify.dev/docs/apps)
[![React Router](https://img.shields.io/badge/Framework-React%20Router%20v7-CA4245.svg?style=for-the-badge&logo=reactrouter&logoColor=white)](https://reactrouter.com/)
[![React](https://img.shields.io/badge/Frontend-React%2018-61DAFB.svg?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Polaris](https://img.shields.io/badge/UI-Shopify%20Polaris%20v13-5C6AC4.svg?style=for-the-badge&logo=shopify&logoColor=white)](https://polaris.shopify.com/)
[![Prisma](https://img.shields.io/badge/ORM-Prisma%20v6-2D3748.svg?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Deployment-Docker%20%7C%20Render-2496ED.svg?style=for-the-badge&logo=docker&logoColor=white)](https://render.com/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg?style=for-the-badge)](LICENSE)

> An enterprise-grade, real-time **RTO (Return to Origin) Analytics & Risk Prediction Embedded Application** built for **Shopify Merchants**. Helps eCommerce brands track delivery trends, identify high-risk products & geographic regions across India, analyze Cash-On-Delivery (COD) vs Prepaid returns, and export presentation-ready reports.

---

## 🌐 Live Production Application & Deployment

| Attribute | Details |
| :--- | :--- |
| **Live App URL** | [`https://real-time-rto-analysis-shopify-based.onrender.com`](https://real-time-rto-analysis-shopify-based.onrender.com) |
| **Deployment Host** | **Render PaaS** (Containerized Docker Web Service) |
| **Database Server** | **PostgreSQL** (Managed Cloud Instance via Prisma ORM) |
| **Container Base** | `node:20-alpine` (Security-hardened least-privilege non-root execution) |
| **Shopify API Version** | `2026-04` (GraphQL Admin API) |
| **App Type** | Embedded Shopify Admin Extension (`embedded = true`) |

---

## ✨ Key Features & Business Value

### 1. 🗺️ State-Wise India Heatmap Visualization
- Interactive geographical heatmap (`IndiaHeatMap.jsx`) mapping delivery metrics and RTO percentages state-by-state across India.
- Visual breakdown of high-risk logistics zones, allowing merchants to restrict COD or adjust shipping rules per region.

### 2. 📊 Real-Time Financial & Order Performance Dashboard
- **Order Metrics**: Total Orders, Delivered, In-Transit, RTO Count, and Return Rate Percentage (%).
- **Revenue Analytics**: Total Gross Revenue, Delivered Revenue, **RTO Loss Impact**, and Net Profit Realization.
- **Interactive Visualizations**: Dynamic trend charts built with `Recharts` (`OrderHistoryChart.jsx`, `BreakdownBarChart.jsx`).

### 3. 🛍️ Product-Level RTO & Risk Profiling
- Product-wise and SKU-wise return rate breakdown (`ProductRTO.jsx`, `ProductRevenue.jsx`).
- Pinpoints specific inventory items causing disproportionate shipping & return losses.

### 4. 💳 Payment Method Risk Analysis (COD vs Prepaid)
- Comprehensive comparison of return rates between **Cash-on-Delivery (COD)** and **Prepaid** payment gateways.
- Enables merchants to optimize payment rules, require partial COD deposits, or offer prepaid incentives.

### 5. 📑 One-Click PowerPoint (.pptx) & Executive Presentation Export
- Export real-time analytics dashboards into fully formatted PowerPoint presentations (`exportPPT.js` powered by `pptxgenjs` and `html2canvas`).
- Perfect for weekly business reviews, logistics audits, and stakeholder reporting.

### 6. 🔍 Multi-Dimensional Filtering Engine
- Filter dashboard metrics by custom Date Ranges (Today, Last 7 Days, Last 30 Days, Custom Range), Order Statuses, Payment Methods, States/Regions, and Product SKUs.

### 7. ⚡ Intelligent GraphQL API Rate Limiting
- Custom Token Bucket Rate Limiter (`rateLimiter.js`) ensuring seamless, high-volume data fetching without exceeding Shopify GraphQL API limits.

---

## 🛠️ Complete Tech Stack

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SHOPIFY RTO ANALYSIS APP                           │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│  Frontend Layer      │  Backend & API       │  Database & Infrastructure    │
│                      │                      │                               │
│  • React 18          │  • Node.js 20.x      │  • PostgreSQL                 │
│  • React Router v7   │  • React Router Server│  • Prisma ORM v6              │
│  • Shopify Polaris   │  • Shopify GraphQL   │  • Render Cloud Host          │
│  • App Bridge React  │  • OAuth 2.0 Auth    │  • Docker (Alpine Linux)      │
│  • Recharts & Maps   │  • Webhook Handlers  │  • Session Storage Prisma     │
└──────────────────────┴──────────────────────┴───────────────────────────────┘
```

### Frontend Framework & UI Design System
- **React 18**: Modern UI engine with hooks and functional state management.
- **React Router v7 (`@react-router/dev`, `@react-router/node`)**: Full-stack server-driven routing and data loaders.
- **Shopify Polaris v13 (`@shopify/polaris`, `@shopify/polaris-icons`)**: Official Shopify design system matching native Shopify admin experience.
- **Shopify App Bridge (`@shopify/app-bridge-react`)**: Seamless embedded app integration inside the Shopify Admin panel.
- **Recharts v3 (`recharts`)**: High-performance data visualization for order trends and revenue loss.

### Backend Server & Shopify API Engine
- **Node.js 20.x Runtime**: High-throughput JavaScript backend environment.
- **Shopify Application Core (`@shopify/shopify-app-react-router`)**: Handles Shopify admin authentication, session management, and GraphQL client initialization.
- **GraphQL Admin API (`2026-04`)**: Efficient data queries fetching orders, products, customers, fulfillment events, and shipping metadata.
- **Rate Limiter (`rateLimiter.js`)**: Queue and bucket manager to prevent API rate limit throttles during batch queries.

### Database & Session Persistence
- **Database Engine**: **PostgreSQL** (Production database storing shop sessions and authentication tokens).
- **ORM**: **Prisma ORM (`^6.19.3`)** for type-safe schema definitions and automatic migrations.
- **Session Storage**: `@shopify/shopify-app-session-storage-prisma` for session persistence across merchant logins.

### Deployment & DevOps Infrastructure
- **Production Server**: **Render PaaS** (`real-time-rto-analysis-shopify-based.onrender.com`).
- **Containerization**: **Docker** (`Dockerfile` based on `node:20-alpine`).
- **Process Security**: Runs under isolated non-root user `appuser:appgroup` adhering to least-privilege security standards.

---

## 🗄️ Database Architecture (Prisma Schema)

The database uses PostgreSQL managed by Prisma to safely persist active Shopify merchant sessions:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id                  String    @id
  shop                String
  state               String
  isOnline            Boolean   @default(false)
  scope               String?
  expires             DateTime?
  accessToken         String
  userId              BigInt?
  firstName           String?
  lastName            String?
  email               String?
  accountOwner        Boolean   @default(false)
  locale              String?
  collaborator        Boolean?  @default(false)
  emailVerified       Boolean?  @default(false)
  refreshToken        String?
  refreshTokenExpires DateTime?
}
```

---

## 📁 Repository Directory Structure

```text
Real-Time-RTO-Analysis-Shopify-App/
├── app/
│   ├── components/           # UI Components & Analytics Views
│   │   ├── IndiaHeatMap.jsx        # Interactive India RTO Heatmap
│   │   ├── OrderCards.jsx          # Order volume & status cards
│   │   ├── RevenueCards.jsx        # Revenue & financial loss metrics
│   │   ├── ProductRTO.jsx          # Product-wise return breakdown
│   │   ├── ProductRevenue.jsx      # Product revenue vs return risk
│   │   ├── RTOAnalysis.jsx         # RTO predictive scoring component
│   │   ├── OrderHistoryChart.jsx   # Time-series order charts
│   │   ├── BreakdownBarChart.jsx   # Status breakdown visualization
│   │   ├── Filters.jsx             # Global date/status/region filter bar
│   │   └── SkeletonDashboard.jsx   # Polaris shimmer loading skeleton
│   ├── routes/               # React Router SSR Routes & API endpoints
│   │   ├── app._index.jsx          # Main RTO Analytics Dashboard
│   │   ├── app.orders.jsx          # Real-time Order Explorer Grid
│   │   ├── health.jsx              # Application Health-check endpoint
│   │   └── webhooks.*.jsx          # Webhook receivers (uninstalled, scope updates)
│   ├── utils/                # Utility Modules
│   │   ├── exportPPT.js            # PowerPoint (.pptx) report generator
│   │   ├── rateLimiter.js          # Shopify GraphQL Rate Limiter
│   │   ├── orders.js               # Order data transformers
│   │   └── loader.js               # Dashboard data loader routines
│   ├── db.server.js          # Prisma database client instance
│   └── shopify.server.js     # Shopify API configuration & Auth loader
├── prisma/
│   └── schema.prisma         # Database models & PostgreSQL configuration
├── extensions/               # Shopify App Extensions (Checkout / UI extensions)
├── Dockerfile                # Production Alpine Docker container configuration
├── shopify.app.toml          # Shopify CLI configuration file
├── package.json              # Dependencies & deployment scripts
└── README.md                 # Complete Application Documentation
```

---

## 🚀 Environment Variables & Configuration

Create a `.env` file in the project root:

```env
# Shopify Credentials
SHOPIFY_API_KEY=581d27169be5b359b888cda24fec4cf7
SHOPIFY_API_SECRET=your_shopify_api_secret_here

# Access Scopes
SCOPES=read_all_orders,read_orders,read_products,read_fulfillments,read_customers,read_shipping,read_assigned_fulfillment_orders,read_inventory

# Application URL (Production or Ngrok Development Tunnel)
SHOPIFY_APP_URL=https://real-time-rto-analysis-shopify-based.onrender.com

# PostgreSQL Database Connection URL
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require

# Server Port
PORT=3000
```

---

## 💻 Local Development Setup

### Prerequisites
- Node.js 20.x or higher
- Shopify CLI installed (`npm install -g @shopify/cli`)
- PostgreSQL instance running (local or cloud)

### Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Aayush-varvatkar/Real-Time-RTO-Analysis.-Shopify-based-Application-.git
   cd Real-Time-RTO-Analysis.-Shopify-based-Application-
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Database Migration & Setup**:
   ```bash
   npm run setup
   ```

4. **Launch Local Shopify Dev Server**:
   ```bash
   npm run dev
   ```

---

## 🐳 Docker Production Build & Deployment

To build and run the Docker container locally or deploy to hosting providers like Render / AWS / GCP:

### Build Container
```bash
docker build -t shopify-rto-analysis .
```

### Run Container
```bash
docker run -p 3000:3000 --env-file .env shopify-rto-analysis
```

---

## 🔐 Security & Shopify Webhooks

- **Least-Privilege Container**: Runs under non-root system account (`appuser`).
- **OAuth 2.0 Session Handling**: Encrypted session storage in PostgreSQL using `@shopify/shopify-app-session-storage-prisma`.
- **Automatic Webhooks**:
  - `app/uninstalled` — Cleans up stored sessions when a merchant uninstalls the app.
  - `app/scopes_update` — Updates shop authorization access dynamically.

---

⭐ **Star this repository if you find this RTO Analysis Shopify app useful!**

*Developed by [Aayush Varvatkar](https://github.com/Aayush-varvatkar)*
