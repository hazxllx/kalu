// The development command must not inherit a deployment mode from the shell.
process.env.NODE_ENV = 'development';
await import('./server.js');
