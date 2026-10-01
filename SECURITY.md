# Security policy

Only the latest released version is supported with security fixes.

Codex Lookout is designed for trusted local networks. Do not expose its HTTP port directly to the public internet. Remote access must use a TLS-secured relay or VPN with device authentication.

The default QR code contains the plain LAN URL and opens the dashboard directly. Any device that can reach the Mac on that trusted network can view tasks and use control actions, so do not run the service on an untrusted Wi-Fi network or forward port `8787`.

Advanced browser-only deployments can set `BRIDGE_REQUIRE_PAIRING=1` to enable the legacy cookie gate. In that mode, treat pairing links and session cookies as secrets. If you suspect exposure, quit the service, remove the stored session secret, and restart to generate a new one.

Please report vulnerabilities privately to the repository maintainer. Include affected versions, reproduction steps, impact, and any proposed mitigation. Do not include real conversation data or credentials.
