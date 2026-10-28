#!/usr/bin/env bash
# تنصيب موقع سواك على سيرفر Ubuntu/Debian (يُشغَّل كـ root).
# Installs Siwak behind nginx (or Apache if that already owns port 80) with a systemd service and Let's Encrypt SSL.
#
#   curl -fsSL https://raw.githubusercontent.com/mohmmadjebreel/Siwak/claude/sawak-dental-clinic-site-74rk5q/deploy/install.sh | bash
#
# Safe to re-run: it updates the code and keeps the existing .env and database.
set -euo pipefail

DOMAIN="${DOMAIN:-siwak.barqradius.com}"
REPO="${REPO:-https://github.com/mohmmadjebreel/Siwak.git}"
BRANCH="${BRANCH:-claude/sawak-dental-clinic-site-74rk5q}"
APP_DIR="${APP_DIR:-/opt/siwak}"
DATA_DIR="${DATA_DIR:-/var/lib/siwak}"
PORT="${PORT:-3010}"
CERT_EMAIL="${CERT_EMAIL:-}"
APP_USER=siwak

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

# ---- Node.js 22 (private copy under /opt, the system node is left untouched) ----
NODE_VERSION="${NODE_VERSION:-v22.22.0}"
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac
NODE_DIR="/opt/node-$NODE_VERSION-linux-$NODE_ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  log "Installing Node.js $NODE_VERSION to $NODE_DIR"
  apt-get install -y -qq xz-utils >/dev/null
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz" | tar -xJ -C /opt
fi
export PATH="$NODE_DIR/bin:$PATH"
NODE_BIN="$NODE_DIR/bin/node"
log "Using node $($NODE_BIN -v) at $NODE_BIN"

# ---- App user & code ----
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

log "Fetching code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --silent

mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"

# ---- .env (created once, never overwritten) ----
if [ ! -f "$APP_DIR/.env" ]; then
  log "Creating $APP_DIR/.env"
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
BASE_URL=https://$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$ADMIN_PASSWORD
CLINIC_TIMEZONE=Asia/Hebron
DEFAULT_COUNTRY_CODE=970
ALLOWED_PHONE_PREFIXES=+97059,+97056
CURRENCY=ILS
HOLD_MINUTES=30
DB_PATH=$DATA_DIR/siwak.db

# SMS: console = messages are only written to the service log (journalctl -u siwak)
SMS_PROVIDER=console
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=

# Payments: demo checkout until a real gateway (stripe / tap) is configured
PAYMENT_PROVIDER=mock
ALLOW_MOCK_PAYMENT=true
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TAP_SECRET_KEY=
EOF
  echo "$ADMIN_PASSWORD" > /root/siwak-admin-password.txt
  chmod 600 /root/siwak-admin-password.txt
else
  PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo "$PORT")"
fi
chown root:"$APP_USER" "$APP_DIR/.env"
chmod 640 "$APP_DIR/.env"

if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet siwak; then
  echo "Port $PORT is already used by another program. Re-run with PORT=<free port>."; exit 1
fi

# ---- systemd ----
log "Configuring systemd service"
cat > /etc/systemd/system/siwak.service <<EOF
[Unit]
Description=Siwak dental clinic website
After=network.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet siwak
systemctl restart siwak
sleep 2
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { journalctl -u siwak -n 30 --no-pager; echo "Service failed to start"; exit 1; }

# ---- Reverse proxy ----
WEB=""
if command -v nginx >/dev/null; then
  WEB=nginx
elif systemctl is-active --quiet apache2 2>/dev/null; then
  WEB=apache
elif ss -ltnH 'sport = :80' | grep -q .; then
  warn "Something other than nginx/Apache is listening on port 80:"; ss -ltnp 'sport = :80'
  echo "Point it at http://127.0.0.1:$PORT for $DOMAIN manually."; exit 1
else
  apt-get install -y -qq nginx >/dev/null
  WEB=nginx
fi

log "Configuring $WEB for $DOMAIN"
if [ "$WEB" = nginx ]; then
  if [ -d /etc/nginx/sites-available ]; then
    CONF=/etc/nginx/sites-available/siwak.conf
  else
    CONF=/etc/nginx/conf.d/siwak.conf
  fi
  # Leave the file alone once certbot has added SSL to it.
  if [ ! -f "$CONF" ] || ! grep -q 'managed by Certbot' "$CONF"; then
    cat > "$CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi
  [ -d /etc/nginx/sites-enabled ] && ln -sf "$CONF" /etc/nginx/sites-enabled/siwak.conf
  nginx -t
  systemctl reload nginx
else
  a2enmod -q proxy proxy_http headers >/dev/null
  CONF=/etc/apache2/sites-available/siwak.conf
  if [ ! -f "$CONF" ]; then
    cat > "$CONF" <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
    RequestHeader set X-Forwarded-Proto "http"
</VirtualHost>
EOF
  fi
  a2ensite -q siwak >/dev/null
  apache2ctl configtest
  systemctl reload apache2
fi

# ---- SSL ----
SERVER_IPS="$(hostname -I) $(curl -fsS -4 -m 5 https://api.ipify.org || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$DOMAIN_IP" ] && grep -qw "$DOMAIN_IP" <<<"$SERVER_IPS"; then
  log "Requesting SSL certificate"
  apt-get install -y -qq certbot "python3-certbot-$WEB" >/dev/null
  EMAIL_ARGS=(--register-unsafely-without-email)
  [ -n "$CERT_EMAIL" ] && EMAIL_ARGS=(-m "$CERT_EMAIL")
  certbot "--$WEB" -d "$DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  [ "$WEB" = apache ] && sed -i 's/X-Forwarded-Proto "http"/X-Forwarded-Proto "https"/' /etc/apache2/sites-available/siwak-le-ssl.conf 2>/dev/null && systemctl reload apache2 || true
  URL="https://$DOMAIN"
else
  warn "$DOMAIN does not point to this server yet (resolves to: ${DOMAIN_IP:-nothing})."
  warn "Add a DNS A record: $DOMAIN -> this server's IP, then re-run this script to get SSL."
  URL="http://$DOMAIN"
fi

log "Done"
echo "Site:        $URL"
echo "Admin:       $URL/admin"
if [ -f /root/siwak-admin-password.txt ]; then
  echo "Admin pass:  $(cat /root/siwak-admin-password.txt)   (saved in /root/siwak-admin-password.txt)"
fi
echo "Logs:        journalctl -u siwak -f"
echo "Settings:    $APP_DIR/.env  (then: systemctl restart siwak)"
