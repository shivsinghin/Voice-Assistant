const { createServer } = require('https');
const http = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

// Set NODE_ENV to 'production' if it's not set
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Use HTTPS by default unless explicitly disabled
const useHttps = process.env.USE_HTTPS !== 'false';
const port = useHttps ? 443 : 3000;

app.prepare().then(() => {
  let server;

  if (useHttps) {
    // Try to use HTTPS with certificates
    try {
      const options = {
        key: fs.readFileSync('/etc/letsencrypt/live/app.shivsingh.com/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/app.shivsingh.com/fullchain.pem'),
        // Add secure TLS configuration to prevent LUCKY 13 attacks
        minVersion: 'TLSv1.2', // Only allow TLS 1.2 and above
        // Only use strong, modern ciphers (prioritizing AEAD ciphers)
        ciphers: [
          'TLS_AES_256_GCM_SHA384',
          'TLS_AES_128_GCM_SHA256',
          'TLS_CHACHA20_POLY1305_SHA256',
          'ECDHE-RSA-AES256-GCM-SHA384',
          'ECDHE-RSA-AES128-GCM-SHA256',
          'ECDHE-ECDSA-AES256-GCM-SHA384',
          'ECDHE-ECDSA-AES128-GCM-SHA256'
        ].join(':'),
        // Disable vulnerable compression
        honorCipherOrder: true,
      };

      server = createServer(options, handleRequest);
      
      // Create HTTP server for redirection
      http.createServer((req, res) => {
        const host = req.headers.host;
        const path = req.url;
        
        // Redirect HTTP to HTTPS
        res.writeHead(301, {
          Location: `https://${host}${path}`
        });
        res.end();
      }).listen(80, (err) => {
        if (err) throw err;
      });
    } catch (err) {
      console.error('Failed to load SSL certificates:', err);
      console.log('Falling back to HTTP server');
      server = http.createServer(handleRequest);
    }
  } else {
    // Use regular HTTP server
    server = http.createServer(handleRequest);
  }

  function handleRequest(req, res) {
    // Set security headers immediately to prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Protection against CVE-2025-29927: Remove the malicious header
    if (req.headers['x-middleware-subrequest']) {
      console.warn('Potentially malicious request detected: x-middleware-subrequest header found');
      delete req.headers['x-middleware-subrequest'];
    }
    
    // Also strip other potentially dangerous headers
    const dangerousHeaders = ['x-middleware-prefetch', 'x-invoke-status', 'x-invoke-path', 'x-invoke-error'];
    dangerousHeaders.forEach(header => {
      if (header in req.headers) {
        delete req.headers[header];
      }
    });
    
    // Preserve cookies for proper authentication
    if (req.headers.cookie) {
      // Make sure auth cookies are preserved
      const cookieHeader = req.headers.cookie;
    }
    
    // Add custom headers to response object
    const originalEnd = res.end;
    res.end = function() {
      originalEnd.apply(this, arguments);
    };
    
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on ${useHttps ? 'https' : 'http'}://localhost:${port} (${process.env.NODE_ENV} mode)`);
  });
});