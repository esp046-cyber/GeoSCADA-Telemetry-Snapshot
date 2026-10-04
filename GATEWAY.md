# Gateway notes: CORS, network exposure, audit

The app is a static page. Keep GeoSCADA off the public internet and put a gateway in the DMZ (or reach it over a VPN such as WireGuard/Tailscale).

## 1. CORS: allow only the app origin
The Pages origin is `https://esp046-cyber.github.io` (no path). Because the app sends an `Authorization` header, the browser sends a preflight request, so answer OPTIONS too.

```nginx
map $http_origin $cors_origin { default ""; "https://esp046-cyber.github.io" $http_origin; }
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
  listen 443 ssl;                      # TLS cert/key lines omitted
  server_name scada-gw.example.org;

  location = /_auth {                  # your token check; returns 200 + X-User, or 401
    internal;
    proxy_pass http://127.0.0.1:9000/verify;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Authorization $http_authorization;
  }

  location /api/ {
    add_header Access-Control-Allow-Origin  $cors_origin always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, OPTIONS" always;
    add_header Vary Origin always;
    if ($request_method = OPTIONS) { return 204; }

    auth_request /_auth;
    auth_request_set $user $upstream_http_x_user;
    proxy_set_header X-Engineer $user;       # identity comes from the token, never the browser body
    proxy_set_header Authorization "";       # do not forward the phone's token to GeoSCADA
    limit_req zone=api burst=20;
    proxy_pass https://geoscada-internal:5481;
  }
}
```
Also restrict writes: allow PUT/POST only on the setpoint and ack paths, and only for tag IDs on an allow-list.

## 2. Audit trail
- Identity: the gateway takes the engineer's ID from the verified token (`X-Engineer` above). The app sends no username.
- On every ack or setpoint write, log: who, tag, old value, new value, timestamp, source IP, result. Use an append-only log the engineer cannot edit.
- To land the entry in the GeoSCADA Event Journal, the gateway would write it using whatever your server version supports (for example an event or comment on the point). I have not verified the exact GeoSCADA call, so confirm it against the Aveva documentation for your version.
