# EREAS – Enterprise Randomized Examination & Analytics System

A LAN-based, secure examination platform with real-time analytics, built using
Node.js, PostgreSQL, Redis, Kafka, and Docker.

## Tech Stack
- Node.js + Express
- PostgreSQL (Dockerized)
- Redis
- Kafka
- Docker & Docker Compose

## Features
- Secure student authentication (JWT)
- Randomized exam engine
- Autosave with crash recovery
- Real-time event streaming
- Scalable architecture

## Setup (Backend)
```bash
cd backend
npm install
cp .env.example .env
node src/server.js