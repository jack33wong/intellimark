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

# Start the built server
CMD ["npm", "start"]
