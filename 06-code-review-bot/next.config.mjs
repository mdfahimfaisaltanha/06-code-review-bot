/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the webhook handler to read the raw body for signature verification
  api: { bodyParser: false },
}
export default nextConfig
