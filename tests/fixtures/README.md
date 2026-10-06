# Test TLS material

`untrusted-proxy-cert.pem` and `untrusted-proxy-key.pem` are a generated, deliberately untrusted test certificate and key for a loopback HTTPS proxy. They are public fixtures, carry no production credentials, and must never be deployed as a real proxy identity. The build only bundles `src/worker.js` and panel assets; these files do not enter release attachments.
