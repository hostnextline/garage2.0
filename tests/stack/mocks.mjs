// Fake outside services for the tests (filled in with the functions).
import http from 'node:http';
http.createServer((req, res) => { res.writeHead(404); res.end('{}'); }).listen(8021, '127.0.0.1');
