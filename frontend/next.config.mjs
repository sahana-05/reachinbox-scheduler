/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://reachinbox-scheduler-xs0m.onrender.com/api/:path*',
      },
    ]
  },
}

export default nextConfig;