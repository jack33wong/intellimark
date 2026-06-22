FROM node:20-slim

# Install the required system dependencies for pdf2pic and fonts for SVG overlays
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    fonts-comic-neue \
    fonts-liberation \
    fonts-dejavu \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Fix the security policy to explicitly allow PDF conversion
RUN sed -i 's/name="pattern" value="PDF" \/>/name="pattern" value="PDF" \/ \n  <policy domain="coder" rights="read | write" pattern="PDF" \/>/' /etc/ImageMagick-6/policy.xml || true

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Expose the port Cloud Run expects
EXPOSE 8080
ENV PORT=8080
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# Start the built server
CMD ["npm", "start"]
