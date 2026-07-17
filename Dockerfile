FROM node:24-alpine

# Install OpenSSL for Prisma engine compatibility in Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package configuration files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for building and prisma db push)
RUN npm ci

# Copy database schema
COPY prisma ./prisma/

# Copy application source code
COPY src ./src/

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# Create a folder for the SQLite database data (to mount as a volume)
RUN mkdir -p /app/data

# Execute Prisma DB push on startup to initialize/update the SQLite database, then start the bot
CMD ["sh", "-c", "npx prisma db push && npm run start"]
