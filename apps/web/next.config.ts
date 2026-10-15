import type { NextConfig } from 'next';

// standalone: the Docker image runs .next/standalone's server.js with only the files the build traced.
const config: NextConfig = { output: 'standalone' };

export default config;
