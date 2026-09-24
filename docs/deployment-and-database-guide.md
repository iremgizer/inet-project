# Self-Hosted Deployment and Database Guide

This guide describes how to run the INET network visualization tool on an Ubuntu 22.04 or newer university server without Render or another cloud application platform.

## 1. Overview

The deployment has three parts:

```text
Browser
  |
  v
Nginx :80  -- serves frontend/dist/ and proxies /api/*
  |
  v
FastAPI/Uvicorn :8000  -- systemd service, bound to localhost
  |
  v
MongoDB -- local on the server or MongoDB Atlas
```

Nginx serves the React static files and acts as the reverse proxy. FastAPI runs continuously as a systemd service and starts automatically after reboot. MongoDB is used for persistent assignments, submissions, and saved simulation runs; it can remain in MongoDB Atlas or run locally on the same server.

The examples below use `/srv/inet-project` as the installation directory and `inet-tool.example.edu` as a placeholder hostname. Replace both with values appropriate for the university server.

## 2. Prerequisites

Log in as a user with `sudo` access. Install:

- Ubuntu 22.04 or newer
- Python 3.11 or newer
- Node.js 18 or newer and npm
- Nginx
- Git
- MongoDB 7, optionally, when the database will be hosted locally

Update the package index and install the system packages:

```bash
sudo apt update
sudo apt install -y git nginx python3.11 python3.11-venv python3-pip
```

Verify the required versions:

```bash
python3 --version
node --version
npm --version
nginx -v
git --version
```

Install Node.js 18 or newer using the university's approved package source. For example, if Node.js is already managed by the server administrator:

```bash
node --version  # must report v18 or newer
```

MongoDB is optional. If the server will use Atlas, do not install a local database.

## 3. Clone and Set Up the Project

Choose an installation directory, clone the repository, and inspect the two application directories:

```bash
sudo mkdir -p /srv
sudo chown "$USER":"$USER" /srv
cd /srv
git clone https://github.com/iremgizer/inet-project.git
cd inet-project
```

The relevant structure is:

```text
/srv/inet-project/
├── backend/
│   ├── app/
│   ├── requirements.txt
│   └── .env                 # created on the server; never commit it
├── frontend/
│   ├── package.json
│   └── dist/                # created by npm run build
└── docs/
```

For a dedicated service account, create it before continuing and give it ownership of the checkout:

```bash
sudo useradd --system --home /srv/inet-project --shell /usr/sbin/nologin inetapp
sudo chown -R inetapp:inetapp /srv/inet-project
```

## 4. Backend Setup

Create a virtual environment and install the pinned backend dependencies:

```bash
cd /srv/inet-project/backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

Create `/srv/inet-project/backend/.env`. Use a real Atlas URI or the local URI described in section 9. Do not commit this file because the MongoDB URI may contain a password.

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<password>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DATABASE=network_visualizer
FRONTEND_ORIGIN=http://inet-tool.example.edu
```

`FRONTEND_ORIGIN` must be the exact browser origin, including `https://` when HTTPS is enabled, with no trailing slash. The backend always permits local development origins and adds this configured production origin for CORS.

There are two supported MongoDB arrangements:

1. Keep MongoDB Atlas and put the Atlas connection string in `MONGODB_URI`. Allow the university server's outbound IP address in the Atlas Network Access settings.
2. Install MongoDB locally and use `mongodb://localhost:27017` in `MONGODB_URI`. On systems whose configured repositories provide the package, the requested package installation is:

```bash
sudo apt update
sudo apt install -y mongodb
```

Ubuntu repositories do not provide the same MongoDB package on every release or institutional mirror. If `apt` cannot find `mongodb`, use the official MongoDB 7 Ubuntu repository approved by the server administrator, then enable and start its service before starting FastAPI.

## 5. Frontend Build

Install the frontend dependencies and create the production static files. Because Nginx exposes the backend under `/api/`, set the Vite build-time API base URL accordingly:

```bash
cd /srv/inet-project/frontend
npm install
VITE_BACKEND_URL=/api npm run build
```

The build creates `frontend/dist/`, containing `index.html` and the compiled assets that Nginx will serve. `VITE_BACKEND_URL` is embedded during the build, so rebuild the frontend whenever this value changes.

## 6. Nginx Configuration

Create `/etc/nginx/sites-available/inet-tool`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name inet-tool.example.edu;

    root /srv/inet-project/frontend/dist;
    index index.html;

    # The trailing slash on proxy_pass removes /api/ before forwarding.
    # /api/health becomes http://127.0.0.1:8000/health.
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Keep the backend health endpoint easy to check from outside.
    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Return index.html for client-side SPA routes.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # HTTPS is recommended for a public university service. Replace this
    # commented section with the certificate paths supplied by Let's Encrypt
    # or the university PKI, then redirect HTTP to HTTPS as appropriate.
    # listen 443 ssl;
    # listen [::]:443 ssl;
    # ssl_certificate /etc/letsencrypt/live/inet-tool.example.edu/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/inet-tool.example.edu/privkey.pem;
}
```

Enable the site, validate the configuration, and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/inet-tool /etc/nginx/sites-enabled/inet-tool
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

For HTTPS, use a certificate issued by Let's Encrypt or by the university's certificate authority. Update `FRONTEND_ORIGIN` to the `https://` origin after enabling HTTPS.

## 7. Systemd Service for FastAPI

Create `/etc/systemd/system/inet-backend.service`:

```ini
[Unit]
Description=INET FastAPI backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=inetapp
Group=inetapp
WorkingDirectory=/srv/inet-project/backend
EnvironmentFile=/srv/inet-project/backend/.env
ExecStart=/srv/inet-project/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Start it and enable automatic startup:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now inet-backend
```

The service binds only to localhost; external traffic reaches it through Nginx. The four Uvicorn workers provide multiple backend processes for concurrent users.

## 8. Subdomain Setup

Ask the university IT or DNS administration team to create a subdomain such as `inet-tool.inet.tu-berlin.de` and point it to the server's public IP address. This is a DNS record change, normally an `A` record for IPv4 and, where applicable, an `AAAA` record for IPv6.

Provide IT with:

- The requested hostname
- The server's public IP address
- The service owner and technical contact
- Whether HTTPS certificates should be issued by the university PKI

DNS changes typically take 24-48 hours to propagate, although the exact time depends on the university's TTL and DNS procedures. After the name resolves, replace `inet-tool.example.edu` in the Nginx configuration and `FRONTEND_ORIGIN` with the real hostname.

## 9. MongoDB Options

### Option A: Keep MongoDB Atlas

Leave the existing Atlas cluster in place and set the backend environment variable to its connection string:

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<password>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DATABASE=network_visualizer
```

In Atlas, create a dedicated database user with only the permissions required for the application and allow the server's outbound IP address under Network Access. Store the URI only in `backend/.env` or another protected service environment; never place it in the frontend or in Git.

### Option B: Install MongoDB locally

Install and start MongoDB 7 using the server administrator's approved Ubuntu package source. If the `mongodb` package is available from the configured repositories:

```bash
sudo apt update
sudo apt install -y mongodb
sudo systemctl enable --now mongodb
```

Point the backend to the local database:

```dotenv
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=network_visualizer
```

Keeping MongoDB bound to localhost prevents direct database access from the network. Back up the `network_visualizer` database according to the university's backup policy; the application does not create backups automatically.

After changing either option, restart the backend and verify `/health`. A response with `"mongoAvailable": true` confirms that the application connected to MongoDB.

## 10. Updating the Deployment

Run updates from the checkout directory. Stop or pause maintenance-sensitive activity before restarting the service:

```bash
cd /srv/inet-project
sudo -u inetapp git pull --ff-only

cd backend
sudo -u inetapp .venv/bin/pip install -r requirements.txt

cd ../frontend
sudo -u inetapp env VITE_BACKEND_URL=/api npm install
sudo -u inetapp env VITE_BACKEND_URL=/api npm run build

sudo systemctl restart inet-backend
sudo systemctl reload nginx
```

Review the service logs after an update:

```bash
sudo journalctl -u inet-backend -n 100 --no-pager
```

Keep `backend/.env` outside Git. A `git pull` must not overwrite production configuration.

## 11. Verifying the Deployment

Check the public backend health endpoint through Nginx:

```bash
curl -fsS http://inet-tool.example.edu/health
```

The response should contain `"status":"ok"`. For a working database connection it should also contain `"mongoAvailable":true`.

Check Nginx configuration and status:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
```

Check the FastAPI systemd service:

```bash
sudo systemctl status inet-backend --no-pager
sudo journalctl -u inet-backend -n 100 --no-pager
```

Finally, open `http://inet-tool.example.edu` or the configured HTTPS URL in a browser. The React application should load, and API requests should appear under `/api/` in the browser's network log.
