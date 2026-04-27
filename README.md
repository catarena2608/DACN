# 🚀 Microservices Performance Optimization with Kubernetes

<div align="center">

![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white)

**A capstone project on optimizing performance and load capacity for a microservices-based e-commerce application deployed on Kubernetes.**

*University of Information Technology — Vietnam National University HCMC*  
*Faculty of Computer Networks & Data Communications*

</div>

---

## 📌 Project Overview

This project addresses real-world challenges in distributed systems by building a production-like **e-commerce microservices platform** capable of handling **10,000 concurrent users**. The system is deployed on Kubernetes with a full observability stack (metrics, logs, tracing) and load testing scenarios.

---

## 🎯 Objectives

- Build a microservices e-commerce application with **6 core services**
- Deploy and orchestrate services on a **Kubernetes** cluster
- Optimize performance using **Redis** (cache, session, rate limiting, leaderboard)
- Implement a complete **observability stack** (Prometheus + Loki + Grafana + Alertmanager)
- Design and execute **load testing scenarios** simulating 10,000 concurrent users

---

## ✅ Expected Outcomes

| ID | Deliverable | Success Criteria |
|----|-------------|-----------------|
| R1 | Microservices app deployed locally via Docker Compose | Stable run with no network errors or bugs |
| R2 | Deployment on Kubernetes staging environment | Stable operation on K8s cluster |
| R3 | Performance boost via Redis cache & session storage | Charts showing higher throughput vs. non-Redis baseline |
| R4 | Leaderboard ranking system | Performance comparison vs. traditional database queries |
| R5 | Monitoring (Prometheus + Loki + Grafana + Alertmanager) | Real-time dashboards showing resource & response time changes under load |
| R6 | Load testing demo — 10,000 concurrent users | System handles peak load with auto-scaling |
| R7 | Incident detection & root cause analysis demo | Visible fault identification with source tracing |

---

## 🏗️ System Architecture

### Services

| Component | Role |
|-----------|------|
| **Frontend** (Web Client & Admin) | User interface |
| **Nginx** | Reverse proxy, rate limiting, load balancing |
| **User Service** | Authentication, JWT, app-level gateway & rate limiting via Redis |
| **Product Service** | Product catalog management |
| **Order Service** | Order lifecycle management |
| **Payment Service** | Payment processing |
| **Rank Service** | Leaderboard & flash-sale ranking |
| **Admin Service** | Cross-database administration |
| **RabbitMQ** | Asynchronous message queue between services |
| **Redis** | Cache · Session · Redlock · Rate Limit · Leaderboard |

### Technology Stack

| Technology | Purpose |
|------------|---------|
| **Docker** | Containerize each service as an image |
| **Docker Compose** | Local development environment |
| **Kubernetes (K8s)** | Production orchestration of all microservices |
| **Prometheus** | Metrics collection from hosts and applications |
| **Loki** | Centralized log aggregation |
| **Grafana** | Visualization of metrics and logs |
| **Alertmanager** | Email alerting on system incidents |
| **Jaeger** | Distributed tracing to detect bottlenecks and latency |
| **Istio** | Service mesh for traffic management, mTLS, and observability |

---

## 🔧 Technical Challenges

1. **High Availability** — Keeping the system operational when one or more microservices fail
2. **Data Consistency** — Handling eventual consistency across User, Product, and Order services over RabbitMQ
3. **Observability** — Centralized tracing and log collection across dozens of containers running simultaneously on Kubernetes
4. **Resource Control** — Tuning CPU/RAM allocation to enable effective **Horizontal Pod Autoscaling (HPA)** at 10,000 users

---

## 📅 10-Week Development Timeline

```
Week 1  │ Build User Gateway — Login, Register, JWT & Blacklist middleware (Redis)
Week 2  │ Build core services: Product, Order, Rank + RabbitMQ integration
Week 3  │ Build Payment & Admin services, finalize Nginx config, Dockerize all services
Week 4  │ Write Kubernetes manifests (YAML) and deploy to K8s cluster
Week 5  │ Deploy Prometheus + Grafana, set up CPU/RAM/Network dashboards
Week 6  │ Deploy Loki for centralized logging, configure Alertmanager email alerts
Week 7  │ Configure Istio + Jaeger for distributed tracing and bottleneck analysis
Week 8  │ Run load testing scenarios, configure HPA, validate auto-scaling behavior
Week 9  │ Write final report, draw architecture diagrams, record demo video
Week 10 │ Finalize presentation slides (12–15 pages) and deliver to instructor
```

---

## 🧪 Load Testing Scenario

The system is stress-tested with a scenario simulating **10,000 concurrent users** hitting the platform simultaneously. Key metrics captured during testing:

- **Response time** under sustained and spike traffic
- **Auto-scaling behavior** of Kubernetes pods (HPA)
- **Resource utilization** (CPU, RAM, network I/O)
- **Incident detection time** and alert delivery latency
