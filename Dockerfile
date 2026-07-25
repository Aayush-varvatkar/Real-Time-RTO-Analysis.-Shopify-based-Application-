FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

# Create a non-root user to run the app (security: principle of least privilege)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json ./

# Use npm ci for reproducible, pinned installs (prevents supply-chain drift)
# If you hit the Rollup/Vite Alpine bug, pin the affected optional dep in package.json overrides instead.
RUN npm ci

COPY . .

# Run the build while we still have devDependencies
RUN npm run build

# Set to production and remove dev dependencies
ENV NODE_ENV=production
RUN npm prune --omit=dev

# Drop privileges before starting the process
USER appuser

CMD ["npm", "run", "docker-start"]
