#!/bin/bash
# ================================================================
# SocialSave Pro - Oracle Cloud Free Tier Deployment Script
# ================================================================
# Run this script on your Oracle Cloud Ubuntu 24.04 instance.
# It installs Node.js, dependencies, and starts the app as a
# systemd service with automatic restarts.
# ================================================================

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────
APP_DIR="/opt/socialsave"
APP_USER="socialsave"
APP_PORT=3001
DOMAIN="" # e.g., "socialsave.pro" — leave empty for IP-only

# ─── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR]${NC} $*" >&2; }

# ─── Root check ──────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    err "Please run as root (use sudo)."
    exit 1
fi

# ─── 1. System updates & dependencies ────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl gnupg git ufw ffmpeg python3 python3-pip

# ─── 2. Install Node.js 22 LTS ──────────────────────────────────────
if ! command -v node &>/dev/null; then
    info "Installing Node.js 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
info "Node.js $(node -v) | npm $(npm -v)"

# ─── 3. Install yt-dlp ──────────────────────────────────────────────
if ! command -v yt-dlp &>/dev/null; then
    info "Installing yt-dlp..."
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp
    chmod +x /usr/local/bin/yt-dlp
fi
info "yt-dlp $(yt-dlp --version 2>/dev/null || echo 'installed')"

# ─── 4. Create app user & directory ──────────────────────────────────
if ! id -u $APP_USER &>/dev/null; then
    useradd -r -s /bin/false -d $APP_DIR $APP_USER
fi
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

# ─── 5. Copy application files ───────────────────────────────────────
# IMPORTANT: Upload your project files to $APP_DIR first, then run this.
# Or clone from git:
#   git clone https://github.com/YOUR_USER/socialsave.git $APP_DIR
#
# Expected structure:
#   $APP_DIR/
#   ├── index.html
#   ├── css/style.css
#   ├── js/main.js
#   └── api-server/
#       ├── package.json
#       ├── server.js
#       └── node_modules/

if [[ ! -f "$APP_DIR/index.html" ]]; then
    warn "index.html not found in $APP_DIR."
    warn "Upload your project files first, then re-run this script."
    warn ""
    warn "  rsync -avz --exclude node_modules ./ user@host:$APP_DIR/"
    exit 1
fi

# ─── 6. Install npm dependencies ─────────────────────────────────────
info "Installing npm dependencies..."
cd "$APP_DIR/api-server"
if [[ ! -d node_modules ]]; then
    su -s /bin/bash $APP_USER -c "cd $APP_DIR/api-server && npm install --production"
fi

# ─── 7. systemd service ──────────────────────────────────────────────
info "Creating systemd service..."
cat > /etc/systemd/system/socialsave.service <<EOF
[Unit]
Description=SocialSave Pro Video Downloader
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/api-server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable socialsave.service
systemctl restart socialsave.service

info "Service status:"
systemctl status socialsave.service --no-pager -l

# ─── 8. Firewall (ufw) ──────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    info "Configuring firewall..."
    ufw allow ssh
    ufw allow $APP_PORT/tcp comment 'SocialSave Pro'
    ufw --force enable
fi

# ─── 9. Nginx reverse proxy (optional) ─────────────────────────────
if [[ -n "$DOMAIN" ]] && command -v nginx &>/dev/null; then
    info "Setting up Nginx reverse proxy for $DOMAIN..."
    apt-get install -y -qq nginx certbot python3-certbot-nginx
    cat > /etc/nginx/sites-available/socialsave <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        client_max_body_size 50m;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/socialsave /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx || warn "Nginx config failed; check certbot."

    info "Run: certbot --nginx -d $DOMAIN to get SSL cert."
fi

# ─── 10. Done ────────────────────────────────────────────────────────
echo ""
info "============================================"
info "  SocialSave Pro deployed successfully!"
info "  App: http://localhost:$APP_PORT"
if [[ -n "$DOMAIN" ]]; then
    info "  URL: https://$DOMAIN"
else
    info "  URL: http://YOUR_INSTANCE_IP:$APP_PORT"
fi
info "============================================"
echo ""
info "Useful commands:"
info "  sudo systemctl status socialsave   # Check app status"
info "  sudo journalctl -u socialsave -f    # Stream logs"
info "  sudo systemctl restart socialsave   # Restart app"
echo ""
