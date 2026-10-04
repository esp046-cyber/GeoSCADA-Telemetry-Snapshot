# GeoSCADA Snapshot: field deployment runbook (Purdue DMZ proxy)

Path: phone (HTTPS 443) → DMZ NGINX → GeoSCADA/IIS host (HTTPS, proxy IP only). Port 5481 and all native Geo SCADA ports stay closed.
Firewall rules: Internet → DMZ proxy TCP 443 only. DMZ proxy → GeoSCADA host TCP 443 only. No connections initiated from the SCADA zone to the DMZ or internet.

## 1. GeoSCADA field service account
Do this in ViewX (Server Configuration → Security). Permission names differ by version, so check them against your Geo SCADA security documentation.
1. Create a user group `FieldMobile`. Create one named account per engineer (no shared logins), with a strong password policy and account lockout enabled.
2. Give the group read/view permission only on the object groups containing the tanks, pumps and alarms the app shows.
3. Give alarm-acknowledge permission on those groups.
4. Give control (write) permission only on the group holding the specific setpoint points (for example P01, P02). Nothing else.
5. Grant no configure, security-admin, server or database-administration rights.
6. On each setpoint point, set engineering limits (min/max) in the point configuration so the server rejects out-of-range writes even if the app is bypassed.
7. Confirm in the REST/WebX interface that the account can read, acknowledge and write only what you expect. Try an object outside its groups and confirm it is denied.

## 2. Proxy setup (Debian/Ubuntu DMZ host)
```bash
sudo apt update && sudo apt install -y nginx fail2ban certbot ufw
nginx -v                                   # must be 1.25.1 or newer, otherwise remove the "http2 on;" line
# Certificate without opening port 80 (DNS challenge):
sudo certbot certonly --manual --preferred-challenges dns -d scada.yourdomain.com
sudo mkdir -p /etc/nginx/tls && sudo cp internal-ca.pem /etc/nginx/tls/     # CA that signed the GeoSCADA/IIS certificate
sudo cp nginx-geoscada.conf /etc/nginx/conf.d/geoscada.conf
sudo sed -i 's/10.10.20.5/<GEOSCADA_IP>/; s/geoscada.internal.local/<IIS_CERT_HOSTNAME>/g' /etc/nginx/conf.d/geoscada.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo ufw default deny incoming && sudo ufw allow 443/tcp
sudo ufw allow from <ADMIN_IP> to any port 22 proto tcp && sudo ufw enable
```
Brute-force protection: failed logins pass through nginx as 401s, so fail2ban bans the source IP.
```bash
sudo tee /etc/fail2ban/filter.d/nginx-scada-auth.conf <<'F'
[Definition]
failregex = ^<HOST> .* "(GET|PUT|POST) /api/\S* HTTP/[\d.]+" 40[13] 
F
sudo tee /etc/fail2ban/jail.d/nginx-scada-auth.local <<'J'
[nginx-scada-auth]
enabled  = true
port     = 443
filter   = nginx-scada-auth
logpath  = /var/log/nginx/access.log
maxretry = 5
findtime = 10m
bantime  = 1h
J
sudo systemctl restart fail2ban
```
Phones on mobile carriers often share an IP (CGNAT). Expect to unban with `sudo fail2ban-client set nginx-scada-auth unbanip <IP>` if a colleague mistypes five times.

## 3. Validation from outside the network (before using the iPhone)
`--user jsmith` prompts for the password, so it stays out of shell history.
```bash
H=https://scada.yourdomain.com; O="Origin: https://esp046-cyber.github.io"
# CORS preflight: expect 204 and Access-Control-Allow-Origin: https://esp046-cyber.github.io
curl -is -X OPTIONS $H/api/tags/R01 -H "$O" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: authorization,content-type"
# Read a tag and the active alarms (expect 200 and JSON)
curl -is --tlsv1.3 --user jsmith -H "$O" $H/api/tags/R01
curl -is --tlsv1.3 --user jsmith -H "$O" "$H/api/alarms?state=active"
# Write a setpoint (use a safe value on a test pump)
curl -is --tlsv1.3 --user jsmith -H "$O" -X PUT $H/api/tags/P01/setpoint -H 'Content-Type: application/json' -d '{"value":4.2}'
# Negative tests
curl -is $H/admin                                   # expect: empty reply (444)
curl -is --user jsmith:wrong $H/api/tags/R01        # expect: 401 (counts toward fail2ban)
curl -is -H "Origin: https://evil.example" $H/api/tags/R01   # expect: 403
curl -sv --tls-max 1.2 $H/ 2>&1 | grep -i "alert\|error"     # expect: handshake failure
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}\n" --user jsmith -H "$O" $H/api/tags/R01; done | sort | uniq -c   # expect some 429
```
If the correct password returns 401 from GeoSCADA, the REST interface does not accept Basic auth. Do not work around it in the app. Instead have the proxy validate each engineer with `auth_basic` and a password file, then inject a service-account credential upstream. You lose per-engineer audit in GeoSCADA, so log the engineer name at the proxy.

Then on the phone: Settings → untick demo mode, enter `https://scada.yourdomain.com`, username and password. Add to Home Screen, then test offline and tank, alarm and write operations with the pump set to a harmless value.
