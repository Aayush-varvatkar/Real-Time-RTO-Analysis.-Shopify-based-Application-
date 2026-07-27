FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

# Create a non-root user to run the app (security: principle of least privilege)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json ./

# DO NOT copy package-lock.json — it is generated on Windows and omits
# @rollup/rollup-linux-x64-musl (Alpine/musl). npm install does a fresh
# platform-aware resolution that picks up the correct optional binary.
# See: https://github.com/npm/cli/issues/4828
RUN npm install

COPY . .

# Run the build while we still have devDependencies
RUN npm run build

# Set to production and remove dev dependencies
ENV NODE_ENV=production
RUN npm prune --omit=dev

# Drop privileges before starting the process
USER appuser

CMD ["npm", "run", "docker-start"]
