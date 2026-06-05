# RCL Watch — production deploy

## Host layout

- **Repo**: `/data/rcl/rcl-watch`
- **Service**: `rcl-watch.service`
- **Nginx vhost**: `/etc/nginx/sites-available/watch.retrocyclesleague.com`
- **Public URL**: `https://watch.retrocyclesleague.com`
- **Local bind**: `127.0.0.1:3004`

## Auth env

Watch shares the dashboard Supabase project. Set these in `/etc/default/rcl-watch` (or `.env.local` for dev):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional: `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.retrocyclesleague.com` (auto-detected on `*.retrocyclesleague.com` hosts).

Login flow: **Log in** on watch → `retrocyclesleague.com/auth/login?returnTo=https://watch.retrocyclesleague.com/...` → OAuth/password → callback redirects back to watch with the shared session cookie.

## One-time install

```bash
cd /data/rcl/rcl-watch
make install
make build

sudo cp ops/systemd/rcl-watch.service /etc/systemd/system/
sudo cp ops/nginx/watch.retrocyclesleague.com.conf /etc/nginx/sites-available/watch.retrocyclesleague.com
sudo ln -sfn /etc/nginx/sites-available/watch.retrocyclesleague.com /etc/nginx/sites-enabled/

# Issue TLS cert (use bootstrap vhost first if HTTPS config is not installed yet)
sudo cp ops/nginx/watch.retrocyclesleague.com.bootstrap.conf /etc/nginx/sites-available/watch.retrocyclesleague.com
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/html -d watch.retrocyclesleague.com
sudo cp ops/nginx/watch.retrocyclesleague.com.conf /etc/nginx/sites-available/watch.retrocyclesleague.com

sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl enable --now rcl-watch.service
```

## Deploy updates

```bash
cd /data/rcl/rcl-watch
make install
make build
sudo systemctl restart rcl-watch.service
make smoke PORT=3004
```

## Smoke checks

```bash
curl -I http://127.0.0.1:3004/
curl -I https://watch.retrocyclesleague.com/
make smoke PORT=3004
```
