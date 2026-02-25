FROM node:20-alpine

# Install build tools and other dependencies
RUN apk add --no-cache git curl build-base python3

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production --no-audit --no-fund

# Copy the rest of the application
COPY . .

# Make scripts executable
RUN chmod +x run.sh

# Expose the port
EXPOSE 54002

# Start the application
CMD ["/bin/sh", "run.sh"]
